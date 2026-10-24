# reaction_info · 反应投料计算

课题组内部使用的反应投料比计算网站（中文 / English）。

- **反应式预览**：输入反应 SMILES 或「名称 + 名称 -> 名称」，用 RDKit（WASM，浏览器本地运行）绘制结构式；试剂、催化剂写在箭头上方，溶剂和反应条件写在下方。
- **画结构（Ketcher）**：「绘制反应式」在页面内画出反应物、箭头和产物后导入；添加化合物时可「画结构」；性质面板中可重画已有化合物的结构。编辑器按需加载（首次约 10 MB）。
- **编辑已有反应**：「编辑反应式」在画板中打开当前反应的反应物和产物结构（试剂、催化剂、溶剂留在投料表中），修改后「更新反应式」；也可「以 SMILES 编辑」——结构相同的化合物保留已填写的当量、形态、纯度等；性质面板中可修改结构、分子式、CAS；保存时区分「保存」（覆盖）与「另存为」，并提示未保存的修改。
- **化合物性质查询**：内置约 60 种常用试剂/溶剂（中英文名、缩写、CAS、密度、市售规格，如 n-BuLi 2.5 M、37% 盐酸、NaH 60%），其余物质查询 PubChem（分子式、分子量、CAS、密度、熔沸点、闪点、溶解性、GHS 危险性）。
- **液体自动查密度**：添加化合物后在后台查询 PubChem 的物态（物理描述、熔点、沸点）和密度；液体自动填入密度并以加料体积（mL）为主显示，查不到时提示「需密度」。密度旁标注来源（试剂库 / PubChem），可手动修改；形态可在 固体 / 液体 / 气体 / 溶液 之间切换。
- **投料计算**：选定基准物（1.0 equiv），当量 / 物质的量 / 质量 / 体积任意一项可编辑，其余自动联动。支持纯度、密度、摩尔浓度溶液、质量分数溶液、催化剂 mol%、溶剂浓度或体积、产物理论产量与产率、整体放大缩小、按目标产物质量反推投料。
- **记录**：自动保存当前反应；「保存」「另存为…」把反应存在本浏览器的「已保存的反应」列表中（换电脑或清除浏览器数据后不可见）；「下载」把反应存为 .json 文件，可备份或发给组里其他人，再通过「已保存的反应 → 从文件打开」导入；导出 Markdown / CSV（Excel 可直接打开）。
- **多次实验**：一个反应（路线）下可以有多次实验。每次实验有自己的投料表与规模、条件、实验步骤、日期、状态（计划中 / 进行中 / 完成 / 失败）、记录人、产物外观和结论。
  - 反应编号可自定义，也可自动生成（按已保存反应的编号顺延，如 `LT-042` → `LT-043`；首次保存时若为空则自动填入）；实验编号默认为「反应编号-序号」（如 `LT-042-2`），也可单独修改。
  - 「新建实验」从任意一次复制投料表、规模、条件（可选是否复制步骤），实际称量、产物质量和结果清空。
  - 实验进行中 / 完成后，投料表多出「实际投料」列：填写实际称量的质量（液体、摩尔浓度溶液、溶剂填体积），自动反算实际当量和与计划的偏差（超过 5% 标红）；产率按基准物的实际用量计算。
  - 已保存的反应列表显示编号、实验次数和最高产率；PDF 报告、Markdown / CSV 导出对应当前实验。旧数据打开时自动成为「实验 1」。
- **试剂批次与鉴定**：投料表每个原料/试剂下有「试剂信息」，记录本次所用的这瓶试剂：商业试剂（供应商、规格、货号、批号）或自制（来源反应、批次号），以及到货/开封日期、测定纯度或标定浓度（如 n-BuLi 滴定为 2.31 M，自动用于投料计算）、鉴定结论（未鉴定 / 鉴定通过 / 有问题）和实际加入的原始记录。
  - 「存入试剂库」后可在任何反应中复用：同一化合物（按 CAS / SMILES / 名称识别）会列出已有批次，点「使用」即带入；每次实验保存的是当时的快照，之后修改库不影响旧记录。
  - 鉴定图谱挂在**批次**上而不是某个反应上：一瓶试剂测过一次核磁，所有用到它的反应、每次实验都能看到。
- **节点图（按化合物组织）**：左侧一列是当前实验的全部化合物；原料/试剂 → 试剂批次 → 鉴定图谱，产物 → 本次实验的样品 → 原始数据 → MNova / PDF / 峰列表。可把文件拖到任一节点上传为其下游；多次实验时可切换「仅当前实验」。
- **参考文献**：粘贴 DOI、doi.org 链接、网址或引用文字；DOI 自动从 Crossref 补全作者、标题、期刊、卷期页，按 ACS 格式显示，并记录与本实验的关系（如参考了 SI 第几页）。
- **导出 Word / Excel**：Word 报告（反应式图片、投料表、试剂信息、产物、实验步骤含上下标与「现象」块、表征数据、参考文献），Excel 工作簿（当前投料、各次实验对比、试剂批次、文献）。
- **全部数据备份**：「已保存的反应」菜单中可导出全部反应和试剂库为一个 JSON 文件，并可从备份恢复（只添加缺少的，不覆盖）；也能读取浏览器版衍生版本的备份。
- **实验步骤（富文本）**：加粗、斜体、上下标、小标题、编号步骤、列表、注意事项、表格；输入时自动格式化化学文本（`CH2Cl2` → CH₂Cl₂、`[M+H]+` → [M+H]⁺、`90 oC` → 90 °C、`->` → →、`50 uL` → 50 µL、`3 x 20` → 3 × 20，转换后按退格键可撤回）；「现象」块单独记录观察到的现象和结果；可全屏编辑；「复制（SI 格式）」粘贴到 Word 时保留上下标。编辑器按需加载；旧的纯文本备注打开时自动转为段落，并同时保存一份纯文本用于搜索和导出。
- **PDF 报告**：「导出 PDF 报告」生成 A4 报告预览（抬头含日期、记录人、实验编号；反应式与条件；投料表；产物与产率；各化合物 GHS 危险类别与 H 说明，导出时从 PubChem 获取；实验步骤），点「保存为 PDF」后在打印对话框中选择「另存为 PDF」。由浏览器生成，文字为矢量、中文正常显示。

## 后端（Cloudflare Worker + D1）

同一个 Worker 同时提供网页（`dist/`）和接口（`/api/*`，代码在 `worker/`）。保存的反应存放在 D1 数据库中，换电脑也能看到；
接口不可用时（例如本地 `npm run dev`），网站自动改用浏览器本地存储，标题栏会显示当前存储位置。

| 接口 | 说明 |
|---|---|
| `GET /api/health` | 健康检查（前端据此选择存储位置） |
| `GET /api/reactions?q=` | 列表（最近保存在前，可按名称 / CAS / 分子式 / SMILES 搜索） |
| `POST /api/reactions` | 新建（可带 `id`，用于上传浏览器里已有的反应） |
| `GET /api/reactions/:id` | 读取 |
| `PUT /api/reactions/:id` | 更新，需带 `baseVersion`；版本不一致返回 409 和服务器上的当前版本 |
| `DELETE /api/reactions/:id` | 删除（软删除，数据库中可恢复） |

- 数据库表由 Worker 自动创建和升级（`worker/schema.ts`），部署流程无需额外的迁移步骤；修改表结构时在 `MIGRATIONS` 末尾追加一项即可。
- 每次保存的完整内容都记录在 `reaction_versions` 表中，便于追溯。
- 正式部署使用 `reaction-info-db`，PR 预览（`wrangler preview`）使用 `reaction-info-db-preview`，见 `wrangler.toml`。
- 本地联调：`npm run dev:worker`（构建后用本地模拟的 D1 运行 Worker，地址 http://127.0.0.1:8787）。

### 表征与谱图（R2 附件）

- 「上传 Bruker 文件夹」可选择或拖入样品文件夹或实验文件夹：按含 `acqus` 的目录拆分为各个实验，在浏览器中打包为 zip（保留 `样品/实验号/…` 结构，下载后 TopSpin / MNova 可直接打开），并从 `acqus`、`procs`、`title` 读取核、溶剂、频率、脉冲程序、实验号、标题；一维谱读取 `pdata/1/1r` 生成缩略图，可在线查看（拖选放大，双击复原）。
- 其他文件（MNova `.mnova`、PDF、图片、JCAMP、CIF 等）原样保存；PDF 和图片可在线预览。
- **节点图**（桌面默认，手机默认列表，可切换）：从左到右为 产物 → 样品 → 原始数据（Bruker 实验）→ 处理文件（MNova）/ 导出（PDF、图片）/ 峰列表。
  - 上传时自动连线：Bruker 实验挂到同名样品节点下（不存在则新建）；MNova / PDF 等按文件名中的样品名、核（1H、13C…）、实验号猜测上游，猜不出则作为顶层节点。
  - 拖动输出口（右侧圆点）到其他节点的输入口建立连接，一个节点可以有多个上游（如一份 MNova 同时用到 ¹H 和 ¹³C）；选中连线按 Delete 断开；不允许形成循环。
  - 把文件拖到某个节点上即上传为它的下游；拖动后的节点位置会保存，「整理节点」可一键自动排布。
  - 选中节点后在右侧查看详情：改名、备注、关联产物、添加峰列表（粘贴 MNova Multiplet Report，可一键插入表征数据，自动补上 `¹H NMR (400 MHz, CDCl₃) δ` 开头）、打包下载该节点及其全部下游。
  - 表征数据旁显示该产物已有的谱图（¹H、¹³C、MS、2D）与缺项；PDF 报告中的附件清单按同样的树形结构列出。
- 附件可关联到化合物并添加备注；产物的「表征数据（SI 格式）」可根据已上传的核磁一键插入开头（如 `¹H NMR (400 MHz, CDCl₃) δ`），并写入 PDF 报告。
- 文件存放在 R2：正式环境 `reaction-info-files`，PR 预览 `reaction-info-files-preview`；上传时由 R2 校验 SHA-256，单个文件上限约 95 MB。

> ⚠️ 目前尚未启用登录（Cloudflare Access）：任何知道网址的人都能查看、修改和删除保存在服务器上的反应。在启用 Access 之前，请不要保存敏感数据。

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
  components/RunBar.tsx  实验切换、新建实验、当前实验信息
  components/LotEditor.tsx  试剂批次（本次实验）与试剂库
  components/References.tsx  参考文献（DOI 查询）
  office/          Word (.docx) / Excel (.xlsx) 导出（手写 OOXML，按需加载）
  components/ProcedureEditor.tsx  实验步骤富文本编辑器（Tiptap，懒加载）
  procedure/       步骤文档：JSON ↔ 纯文本 / 安全 HTML（doc.ts）、化学自动格式规则（chemText.ts、ChemTypography.ts）
  components/Attachments.tsx  表征与谱图卡片（节点图 / 列表、上传、表征数据）
  components/AttachmentGraph.tsx  节点图（React Flow + dagre，懒加载）
  components/NodeInspector.tsx  节点详情面板
  components/SpectrumView.tsx  一维谱查看器
  attachments/     Bruker 数据解析（bruker.ts）、zip、绘图、附件接口客户端；graph.ts 节点关系（纯函数）、uploader.ts 上传与自动连线、pack.ts 打包下载
  useAutoLookup.ts  后台查询物态与密度
  components/      界面组件
  storage/         存储层
    types.ts       ReactionRepo 接口（list / get / create / update(带版本) / remove）
    localRepo.ts   浏览器 localStorage 实现（自动从旧格式迁移）
    apiRepo.ts     服务器实现（/api/reactions），index.ts 按 /api/health 自动选择
    upload.ts      把浏览器里已有的反应上传到服务器
    schema.ts      数据格式版本与读取时的校验/补全
    useSavedDoc.ts 当前打开的保存（id、版本、未保存修改、冲突处理）
    draft.ts / files.ts / ids.ts  草稿、.json 文件、UUID
  chem/lots.ts     试剂批次：快照、试剂库、纯度/浓度回填
  chem/refs.ts     参考文献格式化与 Crossref 解析
  chem/runs.ts     多次实验：当前实验的数据在反应顶层，其余实验存于 runs[]，切换时交换
  i18n.tsx         中英文文案
worker/
  index.ts         API 路由（/api/*），其余请求交给静态资源
  schema.ts        数据库表结构与自动迁移
  reactions.ts     反应接口
  attachments.ts   附件与节点图接口（R2 存文件，D1 存索引、连线和位置）；附件属于反应或试剂批次（lot:<id>）
  lots.ts          试剂库接口（/api/lots）
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
- 登录与权限（Cloudflare Access）
- 常用反应模板（Suzuki、酰胺缩合、格氏反应等）
