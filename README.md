# reaction_info · 反应投料计算

课题组内部使用的反应投料比计算网站（中文 / English）。

- **反应式预览**：输入反应 SMILES 或「名称 + 名称 -> 名称」，用 RDKit（WASM，浏览器本地运行）绘制结构式；试剂、催化剂写在箭头上方，溶剂和反应条件写在下方。
- **画结构（Ketcher）**：「绘制反应式」在页面内画出反应物、箭头和产物后导入；添加化合物时可「画结构」；性质面板中可重画已有化合物的结构。编辑器按需加载（首次约 10 MB）。
- **编辑已有反应**：「编辑反应式」在画板中打开当前反应的反应物和产物结构（试剂、催化剂、溶剂留在投料表中），修改后「更新反应式」；也可「以 SMILES 编辑」——结构相同的化合物保留已填写的当量、形态、纯度等；性质面板中可修改结构、分子式、CAS；保存时区分「保存」（覆盖）与「另存为」，并提示未保存的修改。
- **化合物性质查询**：内置约 60 种常用试剂/溶剂（中英文名、缩写、CAS、密度、市售规格，如 n-BuLi 2.5 M、37% 盐酸、NaH 60%），其余物质查询 PubChem（分子式、分子量、CAS、密度、熔沸点、闪点、溶解性、GHS 危险性）。
- **液体自动查密度**：添加化合物后在后台查询 PubChem 的物态（物理描述、熔点、沸点）和密度；液体自动填入密度并以加料体积（mL）为主显示，查不到时提示「需密度」。密度旁标注来源（试剂库 / PubChem），可手动修改；形态可在 固体 / 液体 / 气体 / 溶液 之间切换。
- **投料计算**：选定基准物（1.0 equiv），当量 / 物质的量 / 质量 / 体积任意一项可编辑，其余自动联动。支持纯度、密度、摩尔浓度溶液、质量分数溶液、催化剂 mol%、溶剂浓度或体积、产物理论产量与产率、整体放大缩小、按目标产物质量反推投料。
- **记录**：自动保存当前反应；「保存」「另存为…」把反应存在本浏览器的「已保存的反应」列表中（换电脑或清除浏览器数据后不可见）；「下载」把反应存为 .json 文件，可备份或发给组里其他人，再通过「已保存的反应 → 从文件打开」导入；导出 Markdown / CSV（Excel 可直接打开）。
- **PDF 报告**：「导出 PDF 报告」生成 A4 报告预览（抬头含日期、记录人、实验编号；反应式与条件；投料表；产物与产率；各化合物 GHS 危险类别与 H 说明，导出时从 PubChem 获取；实验步骤），点「保存为 PDF」后在打印对话框中选择「另存为 PDF」。由浏览器生成，文字为矢量、中文正常显示。

## 本地开发

```bash
npm install      # postinstall 会把 RDKit WASM 复制到 public/rdkit/
npm run dev      # http://localhost:5173
npm test         # 单元测试（计算引擎、分子式解析、试剂库校验）
npm run build    # 输出到 dist/
```

需要 Node.js 20+。

## 部署到 Cloudflare（Workers 静态资源）

`wrangler.toml` 已配置为 Workers 静态资源站点（`[assets] directory = "./dist"`），无需 Worker 脚本。

**方式一：连接 GitHub（推荐，push 后自动部署）**

1. Cloudflare 控制台 → Workers & Pages → Create → Import a repository，选择本仓库。
2. Build command：`npm run build`；Deploy command：`npx wrangler deploy`（默认值即可）。
3. 部署成功后访问 `https://reaction-info.<你的子域>.workers.dev`，也可在 Settings → Domains & Routes 绑定自定义域名。

**方式二：命令行**

```bash
npx wrangler login
npm run deploy   # 构建并部署
```

**仅限课题组访问（可选）**：在 Cloudflare Zero Trust → Access → Applications 中为该 Pages 域名添加一个应用，策略设置为允许指定邮箱（或邮箱域名）登录。50 人以内免费。

## 目录结构

```
src/
  chem/
    stoich.ts      投料计算引擎（纯函数，内部单位 mmol / mg / µL）
    formula.ts     分子式解析、分子量、Hill 式
    elements.ts    原子量表
    library.ts     常用试剂库（中英文名、密度、市售规格）
    pubchem.ts     PubChem PUG REST / PUG View 客户端（带限速与缓存）
    rdkit.ts       RDKit WASM 加载、结构绘制、由 SMILES 求分子式
    resolve.ts     名称 / CAS / SMILES / InChI 解析，粘贴内容 → 化合物与角色
    parseInput.ts  输入格式识别：RXN、Molfile/SDF、InChI、反应 SMILES、名称（CDXML 解析代码保留，界面暂未提供入口）
    cdxml.ts       CDXML 解析（暂未在界面中使用）
  components/StructureEditor.tsx  Ketcher 结构编辑器（懒加载）
  components/Report.tsx  PDF 报告（A4 预览 + 打印样式）
  useAutoLookup.ts  后台查询物态与密度
  components/      界面组件
  storage/         存储层
    types.ts       ReactionRepo 接口（list / get / create / update(带版本) / remove）
    localRepo.ts   浏览器 localStorage 实现（自动从旧格式迁移）
    schema.ts      数据格式版本与读取时的校验/补全
    useSavedDoc.ts 当前打开的保存（id、版本、未保存修改、冲突处理）
    draft.ts / files.ts / ids.ts  草稿、.json 文件、UUID
  i18n.tsx         中英文文案
```

## 计算约定

- 非溶剂组分：物质的量 = 基准物 mmol × 当量。
- 纯品：质量 = mmol × MW ÷ 纯度；液体（或物态未知）的体积 = 质量 ÷ 密度，固体和气体不给体积。
- 摩尔浓度溶液：体积 = mmol ÷ M；（填写溶液密度后）质量 = 体积 × 溶液密度。
- 质量分数溶液：溶液质量 = mmol × MW ÷ wt%；体积 = 溶液质量 ÷ 溶液密度。
- 溶剂：填写浓度（基准物在溶剂中的 mol/L）或直接填写体积。
- 产物：当量表示化学计量比；理论产量 = 基准物 mmol × 当量 × MW。

计算结果仅供参考，请核对试剂标签与 SDS。

## 后续计划

- ChemDraw 粘贴（CDXML，代码已具备）
- 自动配平检查
- 课题组共享反应库（Cloudflare D1 / KV）
- 常用反应模板（Suzuki、酰胺缩合、格氏反应等）
