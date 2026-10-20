# reaction_info · 反应投料计算

课题组内部使用的反应投料比计算网站（中文 / English）。

- **反应式预览**：输入反应 SMILES 或「名称 + 名称 -> 名称」，用 RDKit（WASM，浏览器本地运行）绘制结构式；试剂、催化剂写在箭头上方，溶剂写在下方。
- **化合物性质查询**：内置约 60 种常用试剂/溶剂（中英文名、缩写、CAS、密度、市售规格，如 n-BuLi 2.5 M、37% 盐酸、NaH 60%），其余物质查询 PubChem（分子式、分子量、CAS、密度、熔沸点、闪点、溶解性、GHS 危险性）。
- **投料计算**：选定基准物（1.0 equiv），当量 / 物质的量 / 质量 / 体积任意一项可编辑，其余自动联动。支持纯度、密度、摩尔浓度溶液、质量分数溶液、催化剂 mol%、溶剂浓度或体积、产物理论产量与产率、整体放大缩小、按目标产物质量反推投料。
- **记录**：自动保存当前反应，可保存多个反应（存于本机浏览器），导出 Markdown / CSV（Excel 可直接打开），支持打印。

## 本地开发

```bash
npm install      # postinstall 会把 RDKit WASM 复制到 public/rdkit/
npm run dev      # http://localhost:5173
npm test         # 单元测试（计算引擎、分子式解析、试剂库校验）
npm run build    # 输出到 dist/
```

需要 Node.js 20+。

## 部署到 Cloudflare Pages

**方式一：连接 GitHub（推荐，push 后自动部署）**

1. Cloudflare 控制台 → Workers & Pages → Create → Pages → Connect to Git，选择本仓库。
2. 构建设置：Framework preset 选 `Vite`（或 None），Build command `npm run build`，Build output directory `dist`。
3. 环境变量（可选）：`NODE_VERSION=22`（仓库里已有 `.node-version`）。

**方式二：命令行**

```bash
npx wrangler login
npm run deploy   # 构建并上传 dist/ 到 Pages 项目 reaction-info
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
    resolve.ts     名称 / CAS / SMILES 解析、反应 SMILES 拆分
  components/      界面组件
  i18n.tsx         中英文文案
```

## 计算约定

- 非溶剂组分：物质的量 = 基准物 mmol × 当量。
- 纯品：质量 = mmol × MW ÷ 纯度；体积 = 质量 ÷ 密度。
- 摩尔浓度溶液：体积 = mmol ÷ M；（填写溶液密度后）质量 = 体积 × 溶液密度。
- 质量分数溶液：溶液质量 = mmol × MW ÷ wt%；体积 = 溶液质量 ÷ 溶液密度。
- 溶剂：填写浓度（基准物在溶剂中的 mol/L）或直接填写体积。
- 产物：当量表示化学计量比；理论产量 = 基准物 mmol × 当量 × MW。

计算结果仅供参考，请核对试剂标签与 SDS。

## 后续计划

- 页面内绘制结构（Ketcher）
- 自动配平检查
- 课题组共享反应库（Cloudflare D1 / KV）
- 常用反应模板（Suzuki、酰胺缩合、格氏反应等）
