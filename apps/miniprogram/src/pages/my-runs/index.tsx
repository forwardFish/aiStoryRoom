import { Button, Text, View } from "@tarojs/components";
import { useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { api, nav } from "../../lib/api";

export default function MyRunsPage() {
  const [runs, setRuns] = useState<any[]>([]);
  useDidShow(() => {
    api<any[]>("/my/story-runs").then(setRuns);
  });
  return (
    <View className="page">
      <View className="title">我的故事局</View>
      {runs.map((run) => (
        <View className="card" key={run.id}>
          <View className="row">
            <Text>{run.title}</Text>
            <Text className="tag">{run.status}</Text>
          </View>
          <Text className="subtitle">{run.hook}</Text>
          <Button className="button" onClick={() => nav(`/pages/room/index?runId=${run.id}`)}>继续</Button>
        </View>
      ))}
    </View>
  );
}
