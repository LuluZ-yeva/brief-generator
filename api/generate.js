import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 60 };

const ANALYSIS_PROMPT = `请严格按照以下 JSON 格式输出，所有信息必须来自计划书中真实存在的内容，无法找到的字段填"未披露"。只输出 JSON，不要有任何其他文字：

{
  "companyName": "公司全称",
  "shortName": "公司简称或品牌名",
  "address": "注册地址或运营地址",
  "foundedDate": "成立时间",
  "regCapital": "注册资本",
  "legalRep": "法定代表人 / CEO 姓名",
  "website": "官方网站",
  "contact": "联系方式",
  "summary": "项目简介（2-3句话，说明核心业务和价值主张）",
  "mainBiz": "主营业务详述（不少于200字，涵盖业务模式、服务对象、核心价值）",
  "products": [
    {
      "name": "产品或服务名称",
      "desc": "产品描述（100-150字）",
      "imgPage": -1,
      "hasImg": false
    }
  ],
  "team": [
    { "name": "姓名", "title": "职位", "bg": "教育与工作背景（1-2句）" }
  ],
  "finance": "财务情况（历史营收、盈亏，未披露则说明）",
  "round": "本轮融资阶段",
  "amount": "本轮融资金额",
  "valuation": "投后估值",
  "useOfFunds": "融资用途",
  "prevRounds": "历史融资记录",
  "industry": "所属细分行业（精确描述）",
  "industryDesc": "行业概况（不少于200字，含行业规模、增速、政策背景、发展趋势）",
  "imgPages": [],
  "risks": ["风险点1", "风险点2", "风险点3"],
  "evaluation": "综合评价（不少于150字，含亮点和关注点）"
}

字段说明：
- products[].imgPage：0-based 页面索引，该产品对应图片最可能所在页；无则填 -1
- products[].hasImg：该产品在计划书中是否有配图
- imgPages：包含产品/技术展示图的页面索引（0-based），最多6个`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: '未配置 API Key。请在 Vercel 项目设置 → Environment Variables 中添加 ANTHROPIC_API_KEY。'
    });
  }

  try {
    const { action, text, images, companyName, shortName, industry, mainBiz } = req.body;
    const client = new Anthropic({ apiKey });

    if (action === 'analyze') {
      const truncated = (text || '').substring(0, 80000);
      const content = [
        {
          type: 'text',
          text: `你是专业的一级市场股权投资分析师，请仔细阅读以下商业计划书内容，提取关键信息。\n\n【计划书文字内容】\n${truncated}${(text || '').length > 80000 ? '\n（内容较长，已截取前80000字符）' : ''}\n\n${images?.length ? `【计划书各页截图（共${images.length}页），请仔细观察每页的产品图片】` : ''}`
        }
      ];

      if (images?.length) {
        for (const img of images.slice(0, 12)) {
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
        }
      }

      content.push({ type: 'text', text: ANALYSIS_PROMPT });

      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content }]
      });
      return res.json({ result: msg.content[0].text });
    }

    if (action === 'competitors') {
      const name = shortName || companyName || '本项目';
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: `你是专业的投资分析师。请根据公开信息为以下项目提供竞品分析。\n\n公司：${companyName}（${shortName}）\n行业：${industry}\n主营业务：${(mainBiz || '').substring(0, 400)}\n\n请列出3-5个该领域的主要竞争对手（国内外均可，包括直接和间接竞争者）。只输出 JSON 数组：\n[\n  {\n    "company": "竞品公司名称",\n    "product": "核心产品/服务",\n    "desc": "竞品简介（50-80字）",\n    "strength": "核心优势",\n    "diff": "与${name}的主要差异"\n  }\n]`
        }]
      });
      return res.json({ result: msg.content[0].text });
    }

    return res.status(400).json({ error: '无效的 action 参数' });

  } catch (err) {
    console.error('API error:', err);
    return res.status(500).json({ error: err.message || '服务器内部错误' });
  }
}
