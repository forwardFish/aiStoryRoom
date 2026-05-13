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
  "fate-line": { title: "?????", subtitle: "????????????????????", image: "21_my_fate_line.png" },
  chapters: { title: "????", subtitle: "?????? POV ??????????????", image: "22_my_chapters.png" },
  notifications: { title: "????", subtitle: "?????AI ??????????????", image: "23_notification_center.png" },
  report: { title: "????", subtitle: "??????????????", image: "24_report_feedback.png" },
  generating: { title: "AI ???", subtitle: "???????????????????", image: "25_ai_generating_status.png" },
  actionguard: { title: "ActionGuard ????", subtitle: "??/????/????????????", image: "26_actionguard_rewrite.png" },
  "private-clue": { title: "??????", subtitle: "????????????????????", image: "27_private_clue_detail.png" },
  "fate-net": { title: "??? Lite", subtitle: "???????????????", image: "28_fate_net_lite.png" },
  echoes: { title: "??????", subtitle: "????????????????", image: "29_three_echoes_summary.png" },
  impacts: { title: "???????", subtitle: "????????????????????", image: "30_cross_role_influence_detail.png" },
  strategy: { title: "??????", subtitle: "??/??/??????????", image: "31_action_information_strategy.png" },
  "ai-error": { title: "AI ??/??", subtitle: "AI ????????????????????", image: "32_ai_error_or_fallback.png" },
  "multi-pov": { title: "? POV ????", subtitle: "??????????", image: "33_chapter_reader_multi_pov.png" },
  catalog: { title: "????/???", subtitle: "????????????", image: "34_chapter_catalog_timeline.png" },
  "story-card": { title: "???????", subtitle: "??????????????????", image: "35_personal_story_card_detail.png" },
  poster: { title: "????????", subtitle: "???????????????", image: "36_personal_role_poster_share.png" },
  world: { title: "????", subtitle: "????????????????", image: "37_world_status_overview.png" },
  relationships: { title: "????", subtitle: "??????????????", image: "38_character_relationship_overview.png" },
  timeline: { title: "?????", subtitle: "??????????????????", image: "39_plot_timeline.png" },
  suspicious: { title: "??????", subtitle: "??????????????", image: "40_suspicious_information_panel.png" }
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
      tasks.push(api<any[]>("/admin/action-guard").then((items) => { next.audit = items; }).catch(() => undefined));
    }
    Promise.all(tasks).then(() => setData(next)).catch((error) => setMessage(error.message));
  }

  useDidShow(load);

  async function submitFeedback() {
    await api("/feedback/report", { method: "POST", data: { runId, category: "content_safety", content: "?????????????????" } });
    setMessage("????????? mock audit log?");
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
          <Text className="label">{role?.roleName || "????"}</Text>
          <Text className="subtitle">{role?.personalHook || "??????????????"}</Text>
          <Text className="label">????</Text>
          <Text>{role?.destinyQuestion || "?????????????"}</Text>
          <Text className="label">????</Text>
          {(role?.privateClues || []).map((clue: string) => <View key={clue} className="tag">{clue}</View>)}
          <Text className="label">????</Text>
          <Text className="subtitle">{resolution?.summary || "????? AI ??????????"}</Text>
        </View>
      ) : null}

      {kind === "chapters" || kind === "multi-pov" || kind === "catalog" || kind === "story-card" || kind === "poster" ? (
        <View className="card">
          <Text className="label">??</Text>
          <Text>{chapter?.title || "??????"}</Text>
          {(chapter?.povSectionsJson || []).map((pov: any) => <View key={pov.title} className="card compact"><Text>{pov.title}</Text><Text className="subtitle">{pov.content}</Text></View>)}
          {(chapter?.personalCardsJson || []).map((card: any) => <View key={card.title} className="tag">{card.title}</View>)}
          {chapter?.id ? <Button className="button" onClick={() => nav(`/pages/share/index?chapterId=${chapter.id}`)}>???????</Button> : null}
        </View>
      ) : null}

      {kind === "notifications" ? (
        <View className="card">
          {(data.notifications || []).map((item) => <View key={item.id || item.title} className="card compact"><Text>{item.title}</Text><Text className="subtitle">{item.content}</Text></View>)}
        </View>
      ) : null}

      {kind === "report" ? <Button className="button" onClick={submitFeedback}>????/??</Button> : null}

      {kind === "generating" || kind === "ai-error" || kind === "actionguard" || kind === "strategy" ? (
        <View className="card">
          <Text className="label">????</Text>
          <Text className="subtitle">mock AI / mock audit ??? API ???????????????????????????</Text>
          {(data.audit || []).map((item) => <View key={item.id} className="tag">{item.result || item.status}: {item.riskType || item.message || "guard"}</View>)}
          <Text className="label">??????</Text>
          <Text>?????????????????????hidden ????? AI ??????</Text>
        </View>
      ) : null}

      {kind === "fate-net" || kind === "echoes" || kind === "impacts" || kind === "world" || kind === "relationships" || kind === "timeline" || kind === "suspicious" ? (
        <View className="card">
          <Text className="label">????</Text>
          <Text className="subtitle">?? {data.run?.dangerLevel || 1}/5??????{data.currentNode?.title || "???"}</Text>
          {(data.nodes || []).map((node) => <View key={node.id} className="tag">{node.nodeIndex}. {node.title}</View>)}
          {(data.clues || []).map((clue) => <View key={clue.id || clue.title} className="card compact"><Text>{clue.title}</Text><Text className="subtitle">{clue.description}</Text></View>)}
          {(data.relations || []).map((rel) => <View key={rel.id || rel.publicNote} className="tag">{rel.publicNote || rel.relationType || "????"}</View>)}
          {(resolution?.echoesJson || []).map((echo: any) => <View key={echo.roleName} className="card compact"><Text>?????{echo.roleName}</Text><Text className="subtitle">{echo.personalEcho} / {echo.otherEcho} / {echo.worldEcho}</Text></View>)}
          {(resolution?.crossImpactsJson || []).map((impact: any) => <View key={impact.title} className="card compact"><Text>{impact.title}</Text><Text className="subtitle">{impact.description}</Text></View>)}
        </View>
      ) : null}

      <View className="card">
        <Text className="label">????</Text>
        {order.map((item) => <View key={item} className="tag" onClick={() => nav(`/pages/insight/index?runId=${runId}&kind=${item}`)}>{surfaceMap[item].title}</View>)}
      </View>
    </View>
  );
}
