import Anthropic from '@anthropic-ai/sdk';

export const config = { maxDuration: 60 };

// Robust JSON parser: fixes unescaped newlines/tabs inside string values
function safeParseJSON(text) {
  // Strip markdown code fences
  text = text.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/im, '').trim();

  // Try direct parse first
  try { return JSON.parse(text); } catch (_) {}

  // Extract the outermost { } or [ ]
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');
  let start = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) start = firstBrace;
  else if (firstBracket !== -1) start = firstBracket;
  if (start === -1) throw new Error('响应中未找到 JSON');

  const isObj = text[start] === '{';
  const end = isObj ? text.lastIndexOf('}') : text.lastIndexOf(']');
  const raw = text.substring(start, end + 1);

  try { return JSON.parse(raw); } catch (_) {}

  // Fix unescaped control characters inside JSON strings
  let fixed = '';
  let inString = false;
  let escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (escaped) { fixed += ch; escaped = false; continue; }
    if (ch === '\\') { fixed += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; fixed += ch; continue; }
    if (inString) {
      if (ch === '\n')      { fixed += '\\n'; continue; }
      if (ch === '\r')      { fixed += '\\r'; continue; }
      if (ch === '\t')      { fixed += '\\t'; continue; }
    }
    fixed += ch;
  }

  return JSON.parse(fixed);
}

const ANALYSIS_PROMPT = `请严格按照以下 JSON 格式输出。重要格式要求：
1. 所有字符串值必须在同一行内，不得包含换行符（换行用 \\n 替代）
2. 字符串中的引号用 \\" 转义
3. 只输出 JSON，不要有任何其他文字或代码块标记
4. 无法在计划书中找到的字段填"未披露"

{
  "companyName": "公司全称",
  "shortName": "公司简称或品牌名",
  "address": "注册地址或运营地址",
  "foundedDate": "成立时间",
  "regCapital": "注册资本",
  "legalRep": "法定代表人 / CEO 姓名",
  "website": "官方网站",
  "contact": "联系方式",
  "summary": "项目简介（2-3句话，说明核心业务和价值主张，全部在一行内）",
  "mainBiz": "主营业务详述（不少于200字，全部在一行内）",
  "products": [
    { "name": "产品名称", "desc": "产品描述（100-150字，全部在一行内）", "imgPage": -1, "hasImg": false }
  ],
  "team": [
    { "name": "姓名", "title": "职位", "bg": "背景介绍（一行内）" }
  ],
  "finance": "财务情况（一行内）",
  "round": "融资阶段",
  "amount": "融资金额",
  "valuation": "投后估值",
  "useOfFunds": "融资用途（一行内）",
  "prevRounds": "历史融资记录",
  "industry": "所属细分行业",
  "industryDesc": "行业概况（不少于200字，全部在一行内）",
  "imgPages": [],
  "risks": ["风险点1", "风险点2", "风险点3"],
  "evaluation": "综合评价（不少于150字，全部在一行内）"
}

imgPages 说明：填入包含产品/技术展示图片的页面索引（0-based），最多6个。
products[].imgPage：该产品配图最可能所在页的索引（0-based），无则填 -1。`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: '未配置 API Key。请在 Vercel Settings → Environment Variables 中添加 ANTHROPIC_API_KEY 并重新部署。'
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
          text: `你是专业的一级市场股权投资分析师，请仔细阅读以下商业计划书内容，提取关键信息。\n\n【计划书文字内容】\n${truncated}${(text || '').length > 80000 ? '\n（内容较长，已截取前80000字符）' : ''}\n\n${images?.length ? `【计划书各页截图（共${images.length}页），请仔细观察产品图片】` : ''}`
        }
      ];

      if (images?.length) {
        for (const img of images.slice(0, 10)) {
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
        }
      }

      content.push({ type: 'text', text: ANALYSIS_PROMPT });

      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content }]
      });

      const data = safeParseJSON(msg.content[0].text);
      return res.json({ data });
    }

    if (action === 'competitors') {
      const name = shortName || companyName || '本项目';
      const msg = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: `你是专业的投资分析师。请根据公开信息为以下项目提供竞品分析。\n\n公司：${companyName || ''}（${shortName || ''}）\n行业：${industry || ''}\n主营业务：${(mainBiz || '').substring(0, 400)}\n\n请列出3-5个该领域的主要竞争对手（国内外均可）。只输出 JSON 数组，不要有其他文字：\n[\n  {\n    "company": "竞品公司名称",\n    "product": "核心产品/服务",\n    "desc": "竞品简介（50-80字，一行内）",\n    "strength": "核心优势（一行内）",\n    "diff": "与${name}的主要差异（一行内）"\n  }\n]`
        }]
      });

      try {
        const data = safeParseJSON(msg.content[0].text);
        return res.json({ data });
      } catch (_) {
        return res.json({ data: [] });
      }
    }

    return res.status(400).json({ error: '无效的 action 参数' });

  } catch (err) {
    console.error('[generate] error:', err);
    return res.status(500).json({ error: err.message || '服务器内部错误' });
  }
}
