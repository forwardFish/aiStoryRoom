import { Button, Text, View } from "@tarojs/components";
import { useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { api, nav } from "../../lib/api";

export default function HomePage() {
  const [templates, setTemplates] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);

  useDidShow(() => {
    api<any[]>("/world-templates").then(setTemplates);
    api<any[]>("/my/story-runs").then(setRuns).catch(() => setRuns([]));
  });

  return (
    <View className="page">
      <Text className="subtitle">AI 多人故事局</Text>
      <View className="title">故事局</View>
      <Text className="subtitle">和朋友一起进入一个 AI 生成的故事世界。</Text>
      <Button className="button" onClick={() => nav("/pages/mode/index")}>开一局故事</Button>
      <Button className="button secondary" onClick={() => nav("/pages/my-runs/index")}>我的故事局</Button>
      {runs.slice(0, 2).map((run) => (
        <View className="card" key={run.id} onClick={() => nav(`/pages/room/index?runId=${run.id}`)}>
          <View className="row">
            <Text>{run.title}</Text>
            <Text className="tag">{run.status}</Text>
          </View>
          <Text className="subtitle">{run.hook}</Text>
        </View>
      ))}
      {templates.map((template) => (
        <View className="card" key={template.id} onClick={() => nav(`/pages/create-run/index?templateId=${template.id}&mode=single`)}>
          <View className="row">
            <Text>{template.name}</Text>
            <Text className="tag">{template.genre}</Text>
          </View>
          <Text className="subtitle">{template.hook}</Text>
        </View>
      ))}
    </View>
  );
}
