import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav } from "../../lib/api";

type InsightData = {
  run?: any;
  myRole?: any;
  roles?: any[];
  currentNode?: any;
  nodes?: any[];
  clues?: any[];
  relations?: any[];
  chapters?: any[];
  notifications?: any[];
  audit?: any[];
  latestResolution?: any;
};

const surfaceMap: Record<string, { title: string; subtitle: string; image: string }> = {
  "fate-line": { title: "我的命运线", subtitle: "查看个人钩子、命运问题和本章角色线。", image: "21_my_fate_line.png" },
  chapters: { title: "我的章节", subtitle: "查看多 POV 章节和个人故事卡。", image: "22_my_chapters.png" },
  notifications: { title: "通知中心", subtitle: "查看行动提醒、AI 结算和章节生成通知。", image: "23_notification_center.png" },
  report: { title: "反馈与举报", subtitle: "提交内容反馈并写入 mock 审核日志。", image: "24_report_feedback.png" },
  generating: { title: "AI 生成中", subtitle: "展示 AI 任务状态和可恢复提示。", image: "25_ai_generating_status.png" },
  actionguard: { title: "ActionGuard 改写建议", subtitle: "展示越权、宣布结果、操控他人、跳过剧情的拦截证据。", image: "26_actionguard_rewrite.png" },
  "private-clue": { title: "私密线索", subtitle: "展示仅当前角色可见的动机和秘密。", image: "27_private_clue_detail.png" },
  "fate-net": { title: "命运网 Lite", subtitle: "查看角色、线索和关系的轻量关联。", image: "28_fate_net_lite.png" },
  echoes: { title: "三个回响", subtitle: "个人回响、他人回响、世界回响。", image: "29_three_echoes_summary.png" },
  impacts: { title: "跨角色影响", subtitle: "查看行动如何影响其他角色、线索和关系。", image: "30_cross_role_influence_detail.png" },
  strategy: { title: "行动信息策略", subtitle: "公开、保密、指定分享的 P0 展示。", image: "31_action_information_strategy.png" },
  "ai-error": { title: "AI 错误或兜底", subtitle: "展示 mock AI 失败时的错误状态和重试入口。", image: "32_ai_error_or_fallback.png" },
  "multi-pov": { title: "多 POV 章节", subtitle: "按角色视角阅读章节结果。", image: "33_chapter_reader_multi_pov.png" },
  catalog: { title: "章节目录 / 时间线", subtitle: "查看 SceneNode 推进和章节目录。", image: "34_chapter_catalog_timeline.png" },
  "story-card": { title: "个人故事卡", subtitle: "查看角色高光、未解问题和分享素材。", image: "35_personal_story_card_detail.png" },
  poster: { title: "个人角色海报", subtitle: "展示分享海报入口和分享 token。", image: "36_personal_role_poster_share.png" },
  world: { title: "世界状态", subtitle: "查看危险等级和世界事实变化。", image: "37_world_status_overview.png" },
  relationships: { title: "角色关系", subtitle: "查看关系变化和互相影响。", image: "38_character_relationship_overview.png" },
  timeline: { title: "剧情时间线", subtitle: "按 SceneNode 查看剧情推进。", image: "39_plot_timeline.png" },
  suspicious: { title: "可疑信息面板", subtitle: "汇总线索、风险和异常信息。", image: "40_suspicious_information_panel.png" }
};

const order = Object.keys(surfaceMap);

export default function InsightPage() {
  const router = useRouter();
  const runId = String(router.params.runId || "");
  const kind = String(router.params.kind || "fate-line");
  const meta = surfaceMap[kind] || surfaceMap["fate-line"];
  const [data, setData] = useState<InsightData>({});
  const [message, setMessage] = useState("");

  function load() {
    const next: InsightData = {};
    const tasks: Promise<unknown>[] = [];
    if (runId) {
      tasks.push(api<InsightData>(`/story-runs/${runId}/insights`).then((value) => Object.assign(next, value)));
    }
    if (kind === "notifications") {
      tasks.push(api<any[]>("/notifications").then((items) => { next.notifications = items; }));
    }
    if (kind === "actionguard" || kind === "report") {
      tasks.push(api<any>("/admin/action-guard").then((result) => { next.audit = Array.isArray(result) ? result : [...(result.blockedAudits || []), ...(result.guardEvents || []), ...(result.rejectedActions || [])]; }).catch(() => undefined));
    }
    Promise.all(tasks).then(() => setData(next)).catch((error) => setMessage(error.message));
  }

  useDidShow(load);

  async function submitFeedback() {
    await api("/feedback/report", { method: "POST", data: { runId, category: "content_safety", content: "P0 反馈举报验收提交" } });
    setMessage("已提交反馈并写入 mock audit log。");
  }

  const role = data.myRole?.role || data.roles?.[0];
  const chapter = data.chapters?.[0];
  const resolution = data.latestResolution;

  return (
    <View className="page">
      <Text className="subtitle">{meta.image}</Text>
      <View className="title">{meta.title}</View>
      <Text className="subtitle">{meta.subtitle}</Text>
      {message ? <View className="card danger">{message}</View> : null}

      {kind === "fate-line" || kind === "private-clue" ? (
        <View className="card">
          <Text className="label">{role?.roleName || "待选择角色"}</Text>
          <Text className="subtitle">{role?.personalHook || "暂无命运线钩子"}</Text>
          <Text className="label">命运问题</Text>
          <Text>{role?.destinyQuestion || "暂无命运问题"}</Text>
          <Text className="label">私密线索</Text>
          {(role?.privateClues || []).map((clue: string) => <View key={clue} className="tag">{clue}</View>)}
          <Text className="label">最新结算</Text>
          <Text className="subtitle">{resolution?.summary || "完成节点后显示 AI 结算摘要"}</Text>
        </View>
      ) : null}

      {kind === "chapters" || kind === "multi-pov" || kind === "catalog" || kind === "story-card" || kind === "poster" ? (
        <View className="card">
          <Text className="label">章节</Text>
          <Text>{chapter?.title || "暂无章节"}</Text>
          {(chapter?.povSectionsJson || []).map((pov: any) => <View key={pov.title} className="card compact"><Text>{pov.title}</Text><Text className="subtitle">{pov.content}</Text></View>)}
          {(chapter?.personalCardsJson || []).map((card: any) => <View key={card.title} className="tag">{card.title}</View>)}
          {chapter?.id ? <Button className="button" onClick={() => nav(`/pages/share/index?chapterId=${chapter.id}`)}>生成分享卡</Button> : null}
        </View>
      ) : null}

      {kind === "notifications" ? (
        <View className="card">
          {(data.notifications || []).map((item) => <View key={item.id || item.title} className="card compact"><Text>{item.title}</Text><Text className="subtitle">{item.content}</Text></View>)}
        </View>
      ) : null}

      {kind === "report" ? <Button className="button" onClick={submitFeedback}>反馈 / 举报</Button> : null}

      {kind === "generating" || kind === "ai-error" || kind === "actionguard" || kind === "strategy" ? (
        <View className="card">
          <Text className="label">任务状态</Text>
          <Text className="subtitle">mock AI / mock audit 通过 API 返回，可用于验证生成中、错误和 ActionGuard 状态。</Text>
          {(data.audit || []).map((item) => <View key={item.id} className="tag">{item.result || item.status}: {item.riskType || item.message || "guard"}</View>)}
          <Text className="label">信息策略</Text>
          <Text>公开线索可以共享；私密线索只作为角色动机；hidden 状态保留给 AI 结算。</Text>
        </View>
      ) : null}

      {kind === "fate-net" || kind === "echoes" || kind === "impacts" || kind === "world" || kind === "relationships" || kind === "timeline" || kind === "suspicious" ? (
        <View className="card">
          <Text className="label">世界状态</Text>
          <Text className="subtitle">危险 {data.run?.dangerLevel || 1}/5，当前节点：{data.currentNode?.title || "暂无"}</Text>
          {(data.nodes || []).map((node) => <View key={node.id} className="tag">{node.nodeIndex}. {node.title}</View>)}
          {(data.clues || []).map((clue) => <View key={clue.id || clue.title} className="card compact"><Text>{clue.title}</Text><Text className="subtitle">{clue.description}</Text></View>)}
          {(data.relations || []).map((rel) => <View key={rel.id || rel.publicNote} className="tag">{rel.publicNote || rel.relationType || "关系变化"}</View>)}
          {(resolution?.echoesJson || []).map((echo: any) => <View key={echo.roleName} className="card compact"><Text>三个回响: {echo.roleName}</Text><Text className="subtitle">{echo.personalEcho} / {echo.otherEcho} / {echo.worldEcho}</Text></View>)}
          {(resolution?.crossImpactsJson || []).map((impact: any) => <View key={impact.title} className="card compact"><Text>{impact.title}</Text><Text className="subtitle">{impact.description}</Text></View>)}
        </View>
      ) : null}

      <View className="card">
        <Text className="label">验收入口</Text>
        {order.map((item) => <View key={item} className="tag" onClick={() => nav(`/pages/insight/index?runId=${runId}&kind=${item}`)}>{surfaceMap[item].title}</View>)}
      </View>
    </View>
  );
}
