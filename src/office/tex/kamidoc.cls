%% kamidoc.cls — 中文文档统一样式（参考 Tw93/kami 设计规范）
%% 编译：xelatex 或 lualatex（flora 选项必须用 lualatex）
%% 类选项：print 白底 / numbered 章节编号 / dense 紧凑版 / sample 页脚标「示例数据」/ flora 页边水彩花草
\NeedsTeXFormat{LaTeX2e}
\ProvidesClass{kamidoc}[2026/11/03 v1.1 Kami-style Chinese documents]
\newif\ifkami@print   \kami@printfalse
\newif\ifkami@numbered\kami@numberedfalse
\newif\ifkami@dense   \kami@densefalse
\newif\ifkami@sample  \kami@samplefalse
\newif\ifkami@flora   \kami@florafalse
\DeclareOption{print}{\kami@printtrue}
\DeclareOption{numbered}{\kami@numberedtrue}
\DeclareOption{dense}{\kami@densetrue}
\DeclareOption{sample}{\kami@sampletrue}
\DeclareOption{flora}{\kami@floratrue}
\DeclareOption*{\PassOptionsToClass{\CurrentOption}{ctexart}}
\ProcessOptions\relax
\LoadClass[fontset=none,a4paper,zihao=5]{ctexart}
\RequirePackage{iftex}
\RequirePackage{xcolor}
\RequirePackage{geometry}
\RequirePackage{fancyhdr}
\RequirePackage{enumitem}
\RequirePackage{graphicx}
\RequirePackage{caption}
\RequirePackage{tabularray}
\RequirePackage[most]{tcolorbox}
\RequirePackage{siunitx}
\RequirePackage{chemformula}
\RequirePackage{amsmath}
\RequirePackage{needspace}
\RequirePackage{etoolbox}
\RequirePackage[hidelinks]{hyperref}
\definecolor{parchment}{HTML}{F5F4ED}
\definecolor{ivory}{HTML}{FAF9F5}
\definecolor{border}{HTML}{E8E6DC}
\definecolor{line}{HTML}{D8D5C8}
\definecolor{brand}{HTML}{1B365D}
\definecolor{tagbg}{HTML}{E4ECF5}
\definecolor{brandtint}{HTML}{EEF2F7}
\definecolor{nearblack}{HTML}{141413}
\definecolor{darkwarm}{HTML}{3D3D3A}
\definecolor{olive}{HTML}{504E49}
\definecolor{stone}{HTML}{6B6A64}
\definecolor{breakingbg}{HTML}{F0E0D8}
\definecolor{breakingfg}{HTML}{8B4513}
\ifkami@print
  \definecolor{paper}{HTML}{FFFFFF}
\else
  \colorlet{paper}{parchment}
\fi
\pagecolor{paper}
\newif\ifkami@cjkset \kami@cjksetfalse
\newcommand\kami@trycjk[2]{%
  \ifkami@cjkset\else
    \IfFontExistsTF{#1}{%
      \setCJKmainfont{#1}[#2]\setCJKsansfont{#1}[#2]\setCJKmonofont{#1}[#2]%
      \kami@cjksettrue}{}%
  \fi}
\kami@trycjk{TsangerJinKai02}{AutoFakeBold=1.2}
\kami@trycjk{Source Han Serif SC}{BoldFont={Source Han Serif SC Medium}}
\kami@trycjk{Noto Serif CJK SC}{BoldFont={Noto Serif CJK SC Medium}}
\kami@trycjk{Songti SC}{BoldFont={Songti SC Bold}}
\kami@trycjk{STSong}{AutoFakeBold=1.5}
\kami@trycjk{SimSun}{AutoFakeBold=1.5}
\ifkami@cjkset\else\ClassError{kamidoc}{找不到中文衬线字体}{请安装思源宋体或 Noto Serif CJK SC}\fi
\newif\ifkami@latinset \kami@latinsetfalse
\newcommand\kami@trylatin[2][]{%
  \ifkami@latinset\else
    \IfFontExistsTF{#2}{\setmainfont{#2}[#1]\setsansfont{#2}[#1]\kami@latinsettrue}{}%
  \fi}
\kami@trylatin[BoldFont={Charis Medium}]{Charis}
\kami@trylatin{Charis SIL}
\kami@trylatin{Charter}
\kami@trylatin{Bitstream Charter}
\kami@trylatin{XCharter}
\kami@trylatin{Georgia}
\kami@trylatin{TeX Gyre Pagella}
\newif\ifkami@monoset \kami@monosetfalse
\newcommand\kami@trymono[1]{%
  \ifkami@monoset\else
    \IfFontExistsTF{#1}{\setmonofont{#1}[Scale=MatchLowercase]\kami@monosettrue}{}%
  \fi}
\kami@trymono{JetBrains Mono}
\kami@trymono{SF Mono}
\kami@trymono{Menlo}
\kami@trymono{Consolas}
\kami@trymono{DejaVu Sans Mono}
\ifXeTeX
  \xeCJKsetup{CJKglue={\hskip 0.3pt plus 0.08\baselineskip}}
  \xeCJKDeclareCharClass{CJK}{"2190 -> "21FF, "2460 -> "24FF}
  \newcommand\kami@cjktrack[1]{\xeCJKsetup{CJKglue={\hskip #1}}}
\else
  \ltjsetparameter{kanjiskip={0.3pt plus 0.08\baselineskip}}
  \newcommand\kami@cjktrack[1]{\ltjsetparameter{kanjiskip={#1}}}
\fi
\ifkami@dense
  \renewcommand\normalsize{\@setfontsize\normalsize{9.5pt}{13.8pt}%
    \abovedisplayskip 6pt \belowdisplayskip 6pt}
  \geometry{top=15mm,bottom=17mm,left=18mm,right=18mm,footskip=8mm}
\else
  \renewcommand\normalsize{\@setfontsize\normalsize{10.5pt}{16.3pt}%
    \abovedisplayskip 8pt \belowdisplayskip 8pt}
  \geometry{top=20mm,bottom=22mm,left=22mm,right=22mm,footskip=10mm}
\fi
\renewcommand\small{\@setfontsize\small{9.5pt}{14pt}}
\renewcommand\footnotesize{\@setfontsize\footnotesize{9pt}{13pt}}
\renewcommand\scriptsize{\@setfontsize\scriptsize{8pt}{11pt}}
\linespread{1}
\AtBeginDocument{\normalsize\color{nearblack}}
\setlength\parindent{0pt}
\setlength\parskip{5pt plus 1pt}
\AtBeginDocument{\setlength\parindent{0pt}}
\ctexset{autoindent=false}
\newcommand\kami@hone{\fontsize{16pt}{20pt}\selectfont\bfseries\color{nearblack}}
\newcommand\kami@htwo{\fontsize{13pt}{17pt}\selectfont\bfseries\color{nearblack}}
\newcommand\kami@hthree{\fontsize{11pt}{15pt}\selectfont\bfseries\color{darkwarm}}
\ctexset{
  section={format=\kami@hone\raggedright, beforeskip={22pt plus 4pt minus 2pt},
           afterskip={8pt}, indent=0pt},
  subsection={format=\kami@htwo\raggedright, beforeskip={14pt plus 3pt minus 2pt},
              afterskip={5pt}, indent=0pt},
  subsubsection={format=\kami@hthree\raggedright, beforeskip={10pt plus 2pt},
                 afterskip={3pt}, indent=0pt},
}
\pretocmd{\section}{\par\needspace{6\baselineskip}}{}{}
\pretocmd{\subsection}{\par\needspace{5\baselineskip}}{}{}
\ifkami@numbered
  \setcounter{secnumdepth}{2}
  \ctexset{
    section={number=\chinese{section}, aftername=、},
    subsection={number=\arabic{section}.\arabic{subsection}, aftername=\hspace{0.6em}},
  }
\else
  \setcounter{secnumdepth}{0}
\fi
\def\kami@eyebrow{}
\def\kami@titletag{}
\def\kami@subtitle{}
\def\kami@meta{}
\def\kami@short{}
\def\kami@figvalue{}
\def\kami@figlines{}
\newcommand\eyebrow[1]{\def\kami@eyebrow{#1}}
\newcommand\titletag[1]{\def\kami@titletag{#1}}
\newcommand\subtitle[1]{\def\kami@subtitle{#1}}
\newcommand\meta[1]{\def\kami@meta{#1}}
\newcommand\shorttitle[1]{\def\kami@short{#1}}
\newcommand\headfigure[2]{\def\kami@figvalue{#1}\def\kami@figlines{#2}}
\newcommand\sep{\enspace\textperiodcentered\enspace}
\newcommand\makeheader{%
  \ifx\kami@short\@empty\global\let\kami@short\@title\fi
  \begingroup
  \noindent
  \ifx\kami@figvalue\@empty
    \begin{minipage}[b]{\linewidth}\kami@headleft\end{minipage}%
  \else
    \begin{minipage}[b]{0.66\linewidth}\kami@headleft\end{minipage}%
    \hfill
    \begin{minipage}[b]{0.32\linewidth}\raggedleft
      {\fontsize{24pt}{28pt}\selectfont\color{nearblack}\kami@figvalue}\par\vspace{3pt}
      {\small\color{stone}\kami@figlines}%
    \end{minipage}%
  \fi
  \par\vspace{12pt}
  \noindent{\color{border}\rule{\linewidth}{0.6pt}}\par
  \vspace{6pt}
  \endgroup}
\newcommand\kami@headleft{%
  \raggedright
  \ifx\kami@eyebrow\@empty\else
    {\footnotesize\bfseries\color{brand}\kami@cjktrack{1.2pt}%
     \addfontfeature{LetterSpace=8}\kami@eyebrow}\par\vspace{4pt}%
  \fi
  {\fontsize{26pt}{31pt}\selectfont\bfseries\color{nearblack}\@title}%
  \ifx\kami@titletag\@empty\else
    \hspace{0.5em}{\fontsize{14pt}{17pt}\selectfont\color{stone}\kami@titletag}%
  \fi\par
  \ifx\kami@subtitle\@empty\else\vspace{6pt}{\color{olive}\kami@subtitle}\par\fi
  \ifx\kami@meta\@empty\else\vspace{2pt}{\small\color{stone}\kami@meta}\par\fi}
\pagestyle{fancy}
\fancyhf{}
\renewcommand\headrulewidth{0pt}
\ifkami@sample
  \def\kami@foot{\footnotesize\color{stone}\thepage\sep\kami@short\sep{\color{breakingfg}示例数据}}
\else
  \def\kami@foot{\footnotesize\color{stone}\thepage\sep\kami@short}
\fi
\fancyfoot[C]{\kami@foot}
\fancypagestyle{plain}{\fancyhf{}\fancyfoot[C]{\kami@foot}}
\newcommand\hi[1]{{\color{brand}#1}}
\newcommand\ph[1]{{\color{stone}【#1】}}
\newcommand\tbc[1]{{\color{breakingfg}【待确认：#1】}}
\newcommand\note[1]{{\small\color{olive}#1}}
\newcommand\keyline[2]{%
  {\fontsize{11pt}{17.5pt}\selectfont{\color{brand}\bfseries #1}\quad #2\par}}
\newtcbox{\badge}{on line, colback=tagbg, colframe=tagbg, boxrule=0pt, arc=2pt,
  boxsep=0pt, left=3.5pt, right=3.5pt, top=1.2pt, bottom=1.2pt,
  fontupper=\footnotesize\color{brand}}
\newtcbox{\warnbadge}{on line, colback=breakingbg, colframe=breakingbg, boxrule=0pt,
  arc=2pt, boxsep=0pt, left=3.5pt, right=3.5pt, top=1.2pt, bottom=1.2pt,
  fontupper=\footnotesize\color{breakingfg}}
\newcommand\figph[2][40mm]{%
  \begin{tcolorbox}[colback=ivory, colframe=ivory, boxrule=0pt, arc=4pt,
    width=\linewidth, height=#1, valign=center, halign=center, boxsep=0pt,
    before skip=4pt, after skip=4pt, fontupper=\small\color{stone}]【#2】\end{tcolorbox}}
\newcommand\code[1]{\texttt{\small #1}}
\newcommand\spaced[1]{{\footnotesize\color{brand}\addfontfeature{LetterSpace=20}\kami@cjktrack{3pt}#1}}
\newenvironment{metrics}{%
  \par\vspace{2pt}\noindent{\color{border}\rule{\linewidth}{0.4pt}}\par\vspace{7pt}%
  \noindent\begingroup\def\kami@metricsep{}}{%
  \unskip\endgroup\par\vspace{6pt}\noindent{\color{border}\rule{\linewidth}{0.4pt}}\par\vspace{6pt}}
\newcommand\metric[2]{\kami@metricsep\def\kami@metricsep{\hfill}%
  {\fontsize{16pt}{19pt}\selectfont\color{brand}#1}\hspace{0.35em}{\small\color{olive}#2}}
\tcbset{kamicard/.style={enhanced, colback=ivory, colframe=ivory, boxrule=0pt,
  arc=4pt, left=14pt, right=14pt, top=10pt, bottom=10pt, boxsep=0pt,
  before skip=8pt, after skip=10pt, parbox=false}}
\newcommand\kami@label[2]{{\footnotesize\bfseries\color{#1}#2}\par\vspace{3pt}}
\NewDocumentEnvironment{card}{o}
  {\begin{tcolorbox}[kamicard]\IfValueT{#1}{\kami@label{brand}{#1}}}
  {\end{tcolorbox}}
\NewDocumentEnvironment{caution}{O{注意}}
  {\begin{tcolorbox}[kamicard, colback=breakingbg, colframe=breakingbg]%
   \kami@label{breakingfg}{#1}}
  {\end{tcolorbox}}
\NewTblrTheme{kami}{%
  \DefTblrTemplate{caption}{default}{}%
  \DefTblrTemplate{capcont}{default}{}%
  \DefTblrTemplate{contfoot}{default}{}%
  \DefTblrTemplate{conthead}{default}{}%
  \DefTblrTemplate{note}{default}{}%
  \DefTblrTemplate{remark}{default}{}%
  \SetTblrStyle{firsthead}{font=\small}%
}
\SetTblrInner[longtblr]{
  width=\linewidth, rowsep=3.6pt, colsep=7pt, rowhead=1,
  hline{2}={0.6pt,border}, hline{3-Z}={0.25pt,border},
  row{1}={font=\small\bfseries, fg=darkwarm},
  cells={font=\small},
  column{1}={leftsep=0pt}, column{Z}={rightsep=0pt},
}
\SetTblrOuter[longtblr]{theme=kami, entry=none, label=none, presep=0pt, postsep=4pt}
\ExplSyntaxOn
\int_new:N \l__kami_rows_int
\NewDocumentEnvironment{ktable}{m +b}
  {
    \regex_count:nnN { \c{\\} } {#2} \l__kami_rows_int
    \par
    \int_compare:nNnTF { \l__kami_rows_int } < { 11 }
      { \needspace{ \dim_eval:n { 22pt * ( \l__kami_rows_int + 1 ) + 28pt } } }
      { \needspace{ 6\baselineskip } }
    \kami@puttabletitle
    \begin{longtblr}{#1}#2\end{longtblr}
  }{}
\ExplSyntaxOff
\DeclareCaptionFont{olive}{\color{olive}}
\captionsetup{font={small,olive}, labelsep=quad, skip=6pt}
\captionsetup[table]{position=top, justification=raggedright, singlelinecheck=false}
\captionsetup[figure]{position=bottom, justification=centering}
\def\kami@pendingtitle{}
\newcommand\tabletitle[1]{\def\kami@pendingtitle{#1}}
\newcommand\kami@puttabletitle{%
  \ifx\kami@pendingtitle\@empty\else
    \vspace{4pt}{\small\color{olive}\refstepcounter{table}表 \thetable\quad\kami@pendingtitle}%
    \par\nopagebreak\vspace{3pt}\global\let\kami@pendingtitle\@empty
  \fi}
\setlist{itemsep=2pt, topsep=3pt, parsep=0pt, partopsep=0pt}
\setlist[itemize]{label={\color{stone}\textbullet}, leftmargin=1.3em}
\setlist[itemize,2]{label={\color{stone}--}}
\setlist[enumerate]{label={\color{darkwarm}\arabic*.}, leftmargin=1.6em}
\renewenvironment{quote}{\par\vspace{4pt}\begingroup\leftskip=12pt\color{olive}%
  \noindent\llap{{\color{line}\vrule width 1.5pt}\hspace{10.5pt}}}{\par\endgroup\vspace{4pt}}
\renewenvironment{thebibliography}[1]{%
  \section{参考文献}\small\color{darkwarm}%
  \list{[\arabic{enumiv}]}{\settowidth\labelwidth{[#1]}\leftmargin\labelwidth
    \advance\leftmargin\labelsep\usecounter{enumiv}\itemsep 2pt\parsep 0pt}}%
  {\endlist}
\sisetup{mode=text, per-mode=symbol, range-phrase={～}, list-final-separator={、}}
\ifkami@flora
  \ifluatex\else
    \ClassError{kamidoc}{flora 选项需要 LuaLaTeX}{请用 lualatex 编译本文档}%
  \fi
  \RequirePackage{tikzflora}
  \ifkami@print
    \florasetup{colourway=kami, giltdpi=300}
  \else
    \florasetup{colourway=kami, paper=F5F4ED, giltdpi=300}
  \fi
\fi
\endinput
