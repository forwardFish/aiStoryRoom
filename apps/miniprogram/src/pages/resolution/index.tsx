import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav, redirect } from "../../lib/api";

export default function ResolutionPage() {
  const router = useRouter();
  const runId = String(router.params.runId || "");
  const nodeId = String(router.params.nodeId || "");
  const [actions, setActions] = useState<any[]>([]);
  const [resolution, setResolution] = useState<any>();

  function load() {
    api<any[]>(`/nodes/${nodeId}/actions`).then(setActions);
    api<any>(`/nodes/${nodeId}/resolution`).then(setResolution).catch(() => undefined);
  }
  useDidShow(load);

  async function resolve() {
    const result = await api<any>(`/nodes/${nodeId}/resolve`, { method: "POST" });
    setResolution(result);
  }

  async function next() {
    const state = await api<any>(`/story-runs/${runId}/state`);
    if (state.run.status === "chapter_generated" || state.run.status === "chapter_ready") {
      const chapter = state.chapters?.[0];
      await redirect(`/pages/chapter/index?chapterId=${chapter?.id || ""}&runId=${runId}`);
      return;
    }
    await redirect(`/pages/room/index?runId=${runId}`);
  }

  return (
    <View className="page">
      <View className="title">AI 导演结算</View>
      <View className="card">
        <Text>已提交行动：{actions.length}</Text>
        {actions.map((action) => (
          <View key={action.id} className="tag">{action.role?.roleName}: {action.status}</View>
        ))}
      </View>
      {resolution ? (
        <View className="card">
          <Text className="label">本节点发生了什么</Text>
          <Text className="subtitle">{resolution.summary}</Text>
          <Text className="label">下一节点钩子</Text>
          <Text>{resolution.nextNodeHook}</Text>
        </View>
      ) : (
        <Button className="button" onClick={resolve}>推进剧情</Button>
      )}
      {resolution ? <Button className="button" onClick={next}>进入下一步</Button> : null}
    </View>
  );
}
