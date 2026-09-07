window.RESUME_TOOL_INITIAL_DATA = {
  version: 2,
  updatedAt: "2026-09-07",
  shared: {
    basics: {
      name: "你的姓名",
      phone: "138 0000 0000",
      email: "name@example.com",
      wechat: "wechat-id",
      availability: "求职方向：产品经理｜可一个月内到岗",
      avatar: ""
    },
    education: {
      school: "示例大学",
      degree: "本科",
      major: "信息管理与信息系统",
      period: "2021.09 -- 2025.06",
      details: "GPA：3.8/4.0（专业前 15%）\n主修课程：产品设计、数据分析、用户研究、项目管理"
    },
    skills: [
      {
        id: "skill-product",
        label: "产品能力",
        text: "需求分析、用户研究、PRD 撰写、原型设计、项目推进"
      },
      {
        id: "skill-data",
        label: "数据能力",
        text: "Excel、SQL、基础数据分析与可视化"
      },
      {
        id: "skill-tools",
        label: "常用工具",
        text: "Figma、Axure、Notion、Git、AI 协作工具"
      }
    ]
  },
  library: {
    items: [
      {
        id: "demo-work",
        type: "work",
        title: "示例科技有限公司",
        role: "产品实习生",
        period: "2024.06 -- 2024.09",
        tags: [],
        bullets: [
          "【需求分析】通过用户访谈与反馈整理，识别核心问题并输出需求文档，推动 3 项关键体验优化上线。",
          "【方案落地】协同设计、研发与测试明确范围和排期，跟进验收，版本按计划交付。",
          "【数据复盘】搭建核心指标看板，持续观察上线效果，关键流程完成率提升 18%。"
        ]
      },
      {
        id: "demo-project",
        type: "project",
        title: "校园活动管理平台",
        role: "项目负责人",
        period: "2024.02 -- 2024.05",
        tags: [],
        bullets: [
          "【项目背景】针对活动报名信息分散、通知效率低的问题，设计统一的活动发布与报名流程。",
          "【个人职责】负责调研、需求拆解、原型设计和项目推进，组织团队完成两轮可用性测试。",
          "【项目结果】交付可演示产品，试用用户满意度达到 90%，报名信息整理时间减少 60%。"
        ]
      }
    ]
  },
  profiles: [
    {
      id: "default-template",
      label: "默认模板",
      target: "产品经理",
      sourcePdf: "",
      entries: [
        {
          id: "entry-demo-work",
          libraryId: "demo-work",
          sectionTitle: "工作经历",
          enabled: true,
          customized: false,
          overrides: {}
        },
        {
          id: "entry-demo-project",
          libraryId: "demo-project",
          sectionTitle: "项目经历",
          enabled: true,
          customized: false,
          overrides: {}
        }
      ],
      skillOverrides: null
    }
  ]
};
