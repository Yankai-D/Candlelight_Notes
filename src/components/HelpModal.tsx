import { useState } from 'react'
import { ArrowUpRight } from 'lucide-react'
import { Modal } from './Modal'
import { Acknowledgements } from './Acknowledgements'
import { brand } from '../../shared/brand.mjs'
import '../welcome.css'

export type HelpAction = 'knowledge' | 'settings' | 'import' | 'course-style' | 'startup-settings' | 'storage-settings' | 'library' | 'tree'
const topics = [
  { id: 'start', title: '开始与学习画像', lead: '先说明你的起点，再给每份资料一个具体的学习目标。', action: 'knowledge', actionLabel: '修改学习画像', sections: [
    ['首次进入', '首次设置包含学习画像和 DeepSeek 连接，两步都有“跳过”。进入后，画像在「根系」中维护，Key 在「设置 → 模型连接」中添加。不连接模型也能导入资料、查看原文、编辑和导出已有笔记。'],
    ['根系就是你的稳定画像', '在左侧「根系」中维护学习背景和已具备的基础。画像帮助 AI 判断需要解释哪些前提，不改变笔记既定的文风。读完资料或整理学习树不会自动增加你的知识掌握。'],
    ['为当前资料说明学习目标', '默认目标是“看懂这篇文章”。未生成时可在「我的学习目标」修改；已有笔记使用「调整并重新生成」，在一个窗口里修改目标、说明哪里不合意，再确认生成。当前正文和小纸条先存入历史记录，模板会按新要求重新选择。'],
  ] },
  { id: 'library', title: '资料库与联合资料包', lead: '普通文件夹用于分类，联合资料包将一套课程资料作为整体管理。', action: 'import', actionLabel: '导入学习资料', sections: [
    ['添加与分类', '支持文字 PDF、Word（.docx）、PowerPoint（.pptx）、HTML/HTM、Markdown 和 TXT，最大 50 MB。Word、课件和网页会提取正文并保留原件，复杂图表和版式请对照原件；读取说明需确认后才导入。选定文件后，点击框外或 Esc 不会退出，请使用“取消”。旧版 DOC/PPT 请先另存为新格式；Excel、图片和扫描件 OCR 暂不支持。JSON 仅支持本工具的笔记备份。资料库支持文件夹和阅读状态，状态不代表已经掌握全部内容。'],
    ['联合资料包', '在文件夹设置中选择联合资料包，可继续嵌套学科与单元。打开资料仍是它自己的阅读笔记；首次生成适应性笔记时，可参考最近一层资料包及其下属资料。纯翻译仍只翻译当前原文。'],
    ['新建独立笔记', '进入资料包，点击“新建笔记”，填写名称与整理要求。默认整合当前包和下属包的全部资料；可要求生成复习讲义或练习。文件图标代表原始资料，笔记本图标代表独立笔记，均可在“…”中改名。独立笔记不会被当作下一份笔记的原始资料。'],
    ['来源与继续生成', '独立笔记先规划结构，再逐章生成并保存。中断后继续未完成部分；来源随笔记保存，移动或添加文件不会自动重写它。原文对照可切换来源文件。重新生成会保留历史版本，并根据新的整理要求重新规划，仍使用原来保存的来源；要整理新加入的资料，请新建笔记。'],
    ['选择哪些资料进入学习树', '在资料库的“…”菜单中调整是否编入学习树。联合资料包的成员不单独进入学习树；资料包本身默认不参与，可由你开启。'],
  ] },
  { id: 'reading', title: '阅读与 AI 协作', lead: '正文是一份可编辑的长笔记，追问也可以成为笔记的一部分。', action: 'startup-settings', actionLabel: '调整阅读启动方式', sections: [
    ['两种独立笔记', '默认进入适应性讲解，按画像与学习目标生成；纯翻译忠实翻译原文，不使用画像。在左侧切换阅读方式，两份笔记分别保存。首次选择缺少的版本时才生成，之后直接打开已有内容；重新生成有单独入口，并保留修改前的版本。'],
    ['滚动与原文对照', '右侧笔记可以连续滚动。左侧阅读路线指示当前章节，点击章节即可定位；原文对照跟随笔记位置，点开可以查看更大的上下文。'],
    ['选中、追问、写入', '选中文字，或把光标放到一个段落，再在底部说明哪里没懂。选择“添加讲解纸条”“改写选中文字”或“调整笔记风格”。AI 的协作建议先显示预览，点击“写入笔记”才生效；不满意可放弃。'],
    ['直接编辑与恢复', '正文和小纸条都能手动编辑。工具栏可调整格式、阅读字号与只读状态。AI 修改前会记录版本，可从“修改记录”恢复；直接编辑使用 Ctrl / ⌘ + Z 撤销。'],
  ] },
  { id: 'tree', title: '资料树与理想学习树', lead: '整理已有资料，也能围绕你想达到的目标规划学习路径。', action: 'tree', actionLabel: '打开学习树', sections: [
    ['资料学习树', '按当前资料建立知识结构和快速索引。自动整理会参考文件夹分类，再把资料归入合适的主题。分类结果不写回学习画像，也不作为你已掌握知识的证明。'],
    ['理想学习树', '先查看已保存的目标，点击“新的目标”描述想学会什么。系统分阶段规划知识、阅读与实践任务，保存构建进度。打开节点可查看具体解释、实践要求及资料推荐。'],
    ['从节点导入论文', '知识或阅读节点可查找相关论文。出现可导入来源后，可定位 arXiv 并下载导入；不是所有来源都能直接获取全文。导入后可以像普通资料一样生成笔记。'],
    ['暂停、继续与重建', '中断的构建可从保存进度继续。完成后的改进建议不是自动重建命令；需要新版本时，从重建入口填写调整建议和理由，原树保留。生成、查找与重建都会调用模型。'],
  ] },
  { id: 'model', title: '模型连接与文风模板', lead: '连接决定用哪个模型，模板决定如何组织讲解。', action: 'settings', actionLabel: '打开模型连接', sections: [
    ['保存与测试', '在「设置 → 模型连接」填写 Key。连接保存到本机 .env，重启后继续生效，Key 不会回显。测试草稿不会覆盖已保存的连接；保存后设置锁定，需要点击“修改连接”才能编辑。'],
    ['恢复默认', '“恢复默认连接”恢复默认地址和模型，并清除保存的 Key；“清除 Key”只移除密钥。这些操作不删除笔记或画像。'],
    ['选择启动方式', '在「设置 → 阅读启动」选择手动选择、纯翻译或适应性讲解。默认适应性讲解；改变设置不会重写已有笔记。'],
    ['模板与个人样稿', '内置长文讲述、结构化讲义、题目讲解三套模板。题目讲解按原题与小问给出原文、简短思路和解法；只要提示或答案时遵守具体要求。在「设置 → 模板风格」调整每套的个人样稿或恢复默认，也可添加自定义模板，通常最多五套。旧版已有的额外模板在升级时保留。模板先服从用户任务，再判断资料特点；画像只影响必要铺垫。'],
  ] },
  { id: 'storage', title: '保存、导出与常见问题', lead: '笔记自动保存在本机，导出时按用途选择格式。', action: 'storage-settings', actionLabel: '管理资料保存位置', sections: [
    ['保存位置与统一迁移', '首次默认“文档／烛光笔记”。原文副本和笔记在同一资料文件夹内。设置 → 资料存储中，“保存位置”只改变后续导入的位置；“迁移现有资料到这里”可预览后把已有原文、笔记、回收记录、学习树和生成记录一起移到独立空文件夹。复制并校验后才切换位置和清理旧副本。迁移前关闭其他安装版本；仅处理烛光笔记管理的文件，不搬动最初选择的外部原件。'],
    ['移除、回收与卸载', '资料的“…”中可仅移除记录或移入回收站，两者都保留磁盘文件。在设置 → 资料存储 → 资料备份与恢复中可找回，只有回收站的永久删除才会删除笔记、原文副本及其生成记录，并影响其他关联同一文件的安装版本。已有独立备份不受影响。桌面版卸载会清除 Key 和缓存，保留用户文件和轻量索引；内置原文随程序删除。'],
    ['完整备份与恢复', '在设置 → 资料存储中创建完整备份，包含笔记各版本、原文、画像、模板、分类与学习树，不含 API Key。恢复前先校验和预览，文件放入新目录；可返回恢复前的学习空间。缺失文件会明确提示，不会被当作已备份。'],
    ['找回原文与处理冲突', '原文缺失时可重新选择原文件，保留现有笔记。另一窗口修改了同一笔记时，保存会停止；点击“处理保存冲突”可对照正文节选，把当前修改另存为新笔记，或确认使用磁盘版本。'],
    ['查看生成依据', '阅读界面的修改记录中，可查看生成来源与调用记录：保留当时的目标、画像、模板和实际模型请求，不补造旧记录。校验通过只说明格式与编辑范围通过检查，内容仍需阅读核对。'],
    ['长 PDF、Markdown、JSON', '阅读界面右上角“导出”：长 PDF 保留当前排版、色彩与公式；Markdown 用于文本编辑；JSON 备份包含这份资料的全部阅读方式及原文文字，不包含原始 PDF 文件。原文件请另外保留。'],
    ['连接失败', '检查 Key、服务地址、模型名称、网络和账户余额；修改后先测试，再保存。不要把 Key 放进学习目标或笔记正文。'],
    ['生成中断或格式错误', '先查看进度区域的具体错误。全文整理会逐章保存，“继续未完成部分”不会重复生成成功章节；协作编辑校验失败时，原笔记不会被覆盖。'],
    ['快捷操作', 'Enter 发送 AI 编辑请求；Shift + Enter 换行；Ctrl / ⌘ + Enter 聚焦输入框；F1 打开本指南。关闭应用会先保存已写入的内容，未确认的 AI 建议需要先写入或放弃。'],
  ] },
] as const

export function HelpModal({ initialTopic = 'start', onClose, onAction, fileStorage = false }: { initialTopic?: string; onClose: () => void; onAction?: (action: HelpAction) => void; fileStorage?: boolean }) {
  const [topicId, setTopic] = useState(initialTopic)
  const current = topics.find(topic => topic.id === topicId) || topics[0]
  return <Modal title="使用指南" subtitle={`${brand.windowTitle} · 从第一份资料到自己的学习路径`} onClose={onClose} wide>
    <div className="help-guide"><nav className="help-topics" aria-label="帮助主题">{topics.map(topic => <button key={topic.id} data-help-topic={topic.id} aria-current={topicId === topic.id ? 'page' : undefined} onClick={() => setTopic(topic.id)}>{topic.title}</button>)}<button data-help-topic="about" aria-current={topicId === 'about' ? 'page' : undefined} onClick={() => setTopic('about')}>关于与致谢</button></nav>
    <div className="help-pane" key={topicId}>{topicId === 'about' ? <div className="help-content"><p className="help-brand-story">{brand.tagline}</p><section className="help-introduction" aria-label="项目介绍">{brand.introduction.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section><a href={brand.projectUrl} target="_blank" rel="noopener noreferrer">作者与项目 · {brand.authorName} / {brand.englishName}</a><Acknowledgements /></div> : <>
      <h3>{current.title}</h3><p className="help-lead">{current.lead}</p>
      {current.sections.map(([title, text]) => <section className="help-section" key={title}><h4>{title}</h4><p>{text}</p></section>)}
      {topicId === 'storage' && <section className="help-section help-local-storage"><h4>数据保存在何处</h4><p>{fileStorage ? '资料与笔记位于每次导入时确认的文件夹，默认“文档／烛光笔记”。设置中的“资料存储”显示后续导入位置。应用配置区保存路径索引、画像及偏好，不保存整份 PDF 和笔记正文。启动时会识别默认目录内已有的烛光笔记；也可以从资料库或设置进入“识别已有笔记”，扫描其他文件夹并选择加入。关联后继续使用原位置的文件；编号冲突时保留现有记录，原文缺失时可只读查看已保存笔记。' : '浏览器版资料与笔记保存在当前浏览器的本地资料库。清除网站数据或更换浏览器不会保留这些内容，请提前逐份导出 JSON 备份。'}</p></section>}
      {onAction && 'action' in current && <button className="secondary help-action" onClick={() => onAction(current.action)}>{current.actionLabel}<ArrowUpRight size={14} /></button>}
      {onAction && topicId === 'model' && <button className="text-button help-action" onClick={() => onAction('course-style')}>打开模板风格<ArrowUpRight size={14} /></button>}
    </>}</div></div>
  </Modal>
}
