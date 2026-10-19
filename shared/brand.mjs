// Public-facing identity and introduction. Keep installation IDs, origins and data paths stable.
export const brand = Object.freeze({
  name: '烛光笔记',
  englishName: 'Candlelight Notes',
  windowTitle: '烛光笔记 Candlelight',
  authorName: 'Yankai-D',
  projectUrl: 'https://github.com/Yankai-D/Candlelight_Notes',
  tagline: '流光旁烛，知识成林',
  introduction: Object.freeze([
    '填入你的 API Key，导入想要学习的论文、课件或讲义。让 AI 由浅入深、张弛有度地讲解学习资料，与你共同维护一份学习笔记。你可以随时选中笔记中的内容，向 AI 追问、请求讲解或改写，让笔记随着理解不断完善。',
    '学习树帮助你梳理当前的学习路径，也能围绕目标规划理想的学习路径。打开知识节点，查看 AI 推荐的论文与资料，将可获取的资料导入本地，再生成学习笔记，用“人话”理解其中的概念与原理。',
  ]),
});
