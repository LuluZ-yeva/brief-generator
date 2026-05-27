import Anthropic from '@anthropic-ai/sdk';
import {
  Document, Packer, Paragraph, TextRun, ImageRun,
  Table, TableRow, TableCell, AlignmentType,
  BorderStyle, WidthType
} from 'docx';

export const config = { maxDuration: 60 };

const MODEL = 'claude-sonnet-4-6';

// ── Tool schemas ──────────────────────────────────────────────
const ANALYZE_TOOL = {
  name: 'extract_brief',
  description: '从商业计划书中提取结构化信息，用于生成投资初次考察报告',
  input_schema: {
    type: 'object',
    properties: {
      companyName:  { type: 'string', description: '公司全称' },
      shortName:    { type: 'string', description: '公司简称或品牌名' },
      address:      { type: 'string', description: '注册地址或运营地址，找不到填"未披露"' },
      foundedDate:  { type: 'string', description: '成立时间，找不到填"未披露"' },
      regCapital:   { type: 'string', description: '注册资本，找不到填"未披露"' },
      legalRep:     { type: 'string', description: '法定代表人或CEO姓名，找不到填"未披露"' },
      website:      { type: 'string', description: '官方网站，找不到填"未披露"' },
      contact:      { type: 'string', description: '联系方式，找不到填"未披露"' },
      summary:      { type: 'string', description: '项目简介，2-3句话说明核心业务和价值主张' },
      mainBiz:      { type: 'string', description: '主营业务详述，不少于200字' },
      products: {
        type: 'array',
        description: '主要产品或服务列表',
        items: {
          type: 'object',
          properties: {
            name:    { type: 'string' },
            desc:    { type: 'string', description: '产品描述，100-150字' },
            imgPage: { type: 'integer', description: '产品配图所在页面索引（0-based），无则-1' },
            hasImg:  { type: 'boolean' }
          },
          required: ['name', 'desc', 'imgPage', 'hasImg']
        }
      },
      team: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name:  { type: 'string' },
            title: { type: 'string' },
            bg:    { type: 'string', description: '背景介绍，1-2句' }
          },
          required: ['name', 'title', 'bg']
        }
      },
      finance:      { type: 'string', description: '财务情况，未披露则说明' },
      round:        { type: 'string', description: '融资阶段，找不到填"未披露"' },
      amount:       { type: 'string', description: '融资金额，找不到填"未披露"' },
      valuation:    { type: 'string', description: '投后估值，找不到填"未披露"' },
      useOfFunds:   { type: 'string', description: '融资用途，找不到填"未披露"' },
      prevRounds:   { type: 'string', description: '历史融资，找不到填"未披露"' },
      industry:     { type: 'string', description: '所属细分行业，精确描述' },
      industryDesc: { type: 'string', description: '行业概况，不少于200字' },
      imgPages:     { type: 'array', items: { type: 'integer' }, description: '含产品图片的页面索引（0-based），最多6个' },
      risks:        { type: 'array', items: { type: 'string' }, description: '主要风险点3-5条' },
      evaluation:   { type: 'string', description: '综合评价，不少于150字' }
    },
    required: [
      'companyName','shortName','address','foundedDate','regCapital','legalRep',
      'website','contact','summary','mainBiz','products','team','finance',
      'round','amount','valuation','useOfFunds','prevRounds','industry',
      'industryDesc','imgPages','risks','evaluation'
    ]
  }
};

const COMPETITOR_TOOL = {
  name: 'list_competitors',
  description: '列出指定行业的主要竞品信息',
  input_schema: {
    type: 'object',
    properties: {
      competitors: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            company:  { type: 'string' },
            product:  { type: 'string' },
            desc:     { type: 'string', description: '50-80字简介' },
            strength: { type: 'string', description: '核心优势' },
            diff:     { type: 'string', description: '与目标公司的差异' }
          },
          required: ['company', 'product', 'desc', 'strength', 'diff']
        }
      }
    },
    required: ['competitors']
  }
};

// ── Server-side Word document builder ────────────────────────
function b64ToBuffer(b64) {
  return Buffer.from(b64, 'base64');
}

async function buildDoc(brief, competitors, pageImages) {
  const NAVY = '1e3a5f', BLUE = '1a56db', GRAY = 'f1f5f9', WHITE = 'FFFFFF';
  const F = '微软雅黑', FB = '仿宋';

  const secHead = (num, title) => new Paragraph({
    children: [new TextRun({ text: `${num}、${title}`, bold: true, size: 28, font: F, color: NAVY })],
    spacing: { before: 360, after: 160 },
    border: { bottom: { color: NAVY, style: BorderStyle.SINGLE, size: 8, space: 4 } }
  });
  const sub = (t) => new Paragraph({
    children: [new TextRun({ text: t, bold: true, size: 24, font: F, color: BLUE })],
    spacing: { before: 200, after: 100 }
  });
  const body = (t, ind = true) => new Paragraph({
    children: [new TextRun({ text: t || '未披露', size: 22, font: FB })],
    spacing: { after: 100, line: 360, lineRule: 'auto' },
    indent: ind ? { firstLine: 440 } : {}
  });
  const sp = (b = 100) => new Paragraph({ children: [new TextRun('')], spacing: { before: b, after: 0 } });

  const infoRow = (label, val) => new TableRow({
    children: [
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 20, font: F })], spacing: { after: 0 } })],
        width: { size: 22, type: WidthType.PERCENTAGE },
        shading: { fill: GRAY },
        margins: { top: 80, bottom: 80, left: 120, right: 120 }
      }),
      new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: val || '未披露', size: 20, font: FB })], spacing: { after: 0 } })],
        width: { size: 78, type: WidthType.PERCENTAGE },
        margins: { top: 80, bottom: 80, left: 120, right: 120 }
      })
    ]
  });

  const imgParagraph = (pageImg, maxW = 420) => {
    if (!pageImg?.base64) return null;
    try {
      const scale = Math.min(1, maxW / pageImg.width);
      return new Paragraph({
        children: [new ImageRun({
          data: b64ToBuffer(pageImg.base64),
          transformation: { width: Math.round(pageImg.width * scale), height: Math.round(pageImg.height * scale) }
        })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 120, after: 160 }
      });
    } catch { return null; }
  };

  // Build a lookup: index → pageImage object
  const imgMap = {};
  for (const pi of (pageImages || [])) {
    if (pi.idx != null) imgMap[pi.idx] = pi;
  }

  const ch = [];

  // ── Cover ──
  ch.push(sp(800));
  ch.push(new Paragraph({ children: [new TextRun({ text: brief.companyName || '项目', bold: true, size: 52, font: F, color: NAVY })], alignment: AlignmentType.CENTER, spacing: { after: 200 } }));
  ch.push(new Paragraph({ children: [new TextRun({ text: '初次考察报告', bold: true, size: 40, font: F, color: BLUE })], alignment: AlignmentType.CENTER, spacing: { after: 600 } }));
  ch.push(new Table({
    width: { size: 68, type: WidthType.PERCENTAGE },
    alignment: AlignmentType.CENTER,
    rows: [infoRow('考察人员', ''), infoRow('考察对象', brief.companyName || ''), infoRow('考察地点', ''), infoRow('考察时间', '')]
  }));
  ch.push(sp(600));
  ch.push(new Paragraph({ pageBreakBefore: true, children: [new TextRun('')] }));

  // ── 一、项目概况 ──
  ch.push(secHead('一', '项目概况'));
  ch.push(new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      infoRow('企业名称', brief.companyName), infoRow('注册地址', brief.address),
      infoRow('成立时间', brief.foundedDate), infoRow('注册资本', brief.regCapital),
      infoRow('法定代表人', brief.legalRep), infoRow('官方网站', brief.website),
      infoRow('联系方式', brief.contact)
    ]
  }));
  ch.push(sp(160)); ch.push(sub('项目简介')); ch.push(body(brief.summary));

  // ── 二、主营业务 ──
  ch.push(secHead('二', '主营业务'));
  ch.push(body(brief.mainBiz));
  if (brief.products?.length) {
    ch.push(sp(120)); ch.push(sub('主要产品 / 服务'));
    for (const p of brief.products) {
      ch.push(new Paragraph({ children: [new TextRun({ text: '▌ ' + p.name, bold: true, size: 24, font: F, color: NAVY })], spacing: { before: 200, after: 80 } }));
      ch.push(body(p.desc, false));
      if (p.hasImg && p.imgPage >= 0) {
        const img = imgParagraph(imgMap[p.imgPage], 400);
        if (img) ch.push(img);
      }
    }
  }
  if (brief.imgPages?.length) {
    const used = new Set((brief.products || []).map(p => p.imgPage));
    const extra = brief.imgPages.filter(i => !used.has(i) && imgMap[i]);
    if (extra.length) {
      ch.push(sp(120)); ch.push(sub('产品 / 技术展示'));
      for (const idx of extra.slice(0, 4)) {
        const img = imgParagraph(imgMap[idx], 440);
        if (img) ch.push(img);
      }
    }
  }

  // ── 三、核心团队 ──
  ch.push(secHead('三', '核心团队'));
  if (brief.team?.length) {
    for (const m of brief.team) {
      ch.push(new Paragraph({ children: [new TextRun({ text: m.name, bold: true, size: 24, font: F }), new TextRun({ text: '　' + (m.title || ''), size: 22, font: F, color: BLUE })], spacing: { before: 160, after: 60 } }));
      ch.push(body(m.bg, false));
    }
  } else { ch.push(body('计划书中未披露详细团队信息。')); }

  // ── 四、财务情况 ──
  ch.push(secHead('四', '财务情况'));
  ch.push(body(brief.finance || '计划书中未披露详细财务数据。'));

  // ── 五、融资情况 ──
  ch.push(secHead('五', '融资情况'));
  const finRows = [];
  if (brief.round && brief.round !== '未披露') finRows.push(infoRow('融资阶段', brief.round));
  if (brief.amount && brief.amount !== '未披露') finRows.push(infoRow('融资金额', brief.amount));
  if (brief.valuation && brief.valuation !== '未披露') finRows.push(infoRow('投后估值', brief.valuation));
  if (brief.useOfFunds && brief.useOfFunds !== '未披露') finRows.push(infoRow('融资用途', brief.useOfFunds));
  if (brief.prevRounds && brief.prevRounds !== '未披露') finRows.push(infoRow('历史融资', brief.prevRounds));
  if (finRows.length) ch.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: finRows }));
  else ch.push(body('计划书中未披露详细融资信息。'));

  // ── 六、行业情况 ──
  ch.push(secHead('六', '行业情况'));
  ch.push(body(brief.industryDesc));
  if (competitors?.length) {
    ch.push(sp(140)); ch.push(sub('主要竞品分析'));
    const hdr = new TableRow({
      tableHeader: true,
      children: ['竞品公司', '核心产品', '简介', '核心优势'].map((t, i) =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: t, bold: true, size: 20, font: F, color: WHITE })], alignment: AlignmentType.CENTER, spacing: { after: 0 } })],
          shading: { fill: NAVY },
          width: { size: [20, 20, 35, 25][i], type: WidthType.PERCENTAGE },
          margins: { top: 80, bottom: 80, left: 100, right: 100 }
        })
      )
    });
    const rows = competitors.map((c, ri) => new TableRow({
      children: [c.company, c.product, c.desc, c.strength].map(val =>
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: val || '—', size: 19, font: FB })], spacing: { after: 0 } })],
          shading: ri % 2 === 0 ? {} : { fill: GRAY },
          margins: { top: 80, bottom: 80, left: 100, right: 100 }
        })
      )
    }));
    ch.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [hdr, ...rows] }));
    ch.push(new Paragraph({ children: [new TextRun({ text: '注：竞品信息来源于 Claude AI 公开知识库，仅供参考。', size: 18, font: FB, color: '9ca3af', italics: true })], spacing: { before: 80 } }));
  }

  // ── 七、风险点 ──
  ch.push(secHead('七', '风险点'));
  if (brief.risks?.length) {
    brief.risks.forEach(r => ch.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: r, size: 22, font: FB })], spacing: { after: 80 } })));
  } else { ch.push(body('计划书中未披露相关信息。')); }

  // ── 八、综合评价 ──
  ch.push(secHead('八', '综合评价'));
  ch.push(body(brief.evaluation));

  const doc = new Document({
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1584, right: 1584 } } }, children: ch }]
  });
  return await Packer.toBuffer(doc);
}

// ── Handler ───────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: '未配置 ANTHROPIC_API_KEY，请在 Vercel Settings → Environment Variables 中添加后 Redeploy。' });
  }

  try {
    const { action, text, images, companyName, shortName, industry, mainBiz, briefData, competitors, pageImages } = req.body;

    // ── docx generation (no AI needed) ──
    if (action === 'docx') {
      const buf = await buildDoc(briefData, competitors, pageImages);
      return res.json({ data: { docx: buf.toString('base64') } });
    }

    const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    // ── analyze ──
    if (action === 'analyze') {
      const truncated = (text || '').substring(0, 80000);
      const content = [
        { type: 'text', text: `你是专业的一级市场股权投资分析师。请仔细阅读以下商业计划书，调用 extract_brief 工具提取所有关键信息。所有信息必须来自计划书中真实存在的内容，找不到的字段填"未披露"。\n\n【计划书文字内容】\n${truncated}${(text||'').length>80000?'\n（已截取前80000字符）':''}\n\n${images?.length?`【计划书各页截图（共${images.length}页）】`:''}` }
      ];
      if (images?.length) {
        for (const img of images.slice(0, 10))
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: img } });
      }
      const msg = await ai.messages.create({ model: MODEL, max_tokens: 8000, tools: [ANALYZE_TOOL], tool_choice: { type: 'tool', name: 'extract_brief' }, messages: [{ role: 'user', content }] });
      const tu = msg.content.find(c => c.type === 'tool_use');
      if (!tu) throw new Error('AI 未返回结构化数据，请重试');
      return res.json({ data: tu.input });
    }

    // ── competitors ──
    if (action === 'competitors') {
      const name = shortName || companyName || '本项目';
      const msg = await ai.messages.create({ model: MODEL, max_tokens: 3000, tools: [COMPETITOR_TOOL], tool_choice: { type: 'tool', name: 'list_competitors' }, messages: [{ role: 'user', content: `公司：${companyName}（${shortName}）\n行业：${industry}\n主营：${(mainBiz||'').substring(0,300)}\n\n请调用 list_competitors 工具，列出3-5个该行业的主要竞争对手，与${name}进行对比分析。` }] });
      const tu = msg.content.find(c => c.type === 'tool_use');
      return res.json({ data: tu?.input?.competitors || [] });
    }

    return res.status(400).json({ error: '无效的 action' });

  } catch (err) {
    console.error('[generate]', err);
    return res.status(500).json({ error: err.message || '服务器内部错误' });
  }
}
