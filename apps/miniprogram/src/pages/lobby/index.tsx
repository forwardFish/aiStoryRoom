import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav } from "../../lib/api";

export default function LobbyPage() {
  const runId = String(useRouter().params.runId || "");
  const [run, setRun] = useState<any>();
  useDidShow(() => {
    api<any>(`/story-runs/${runId}`).then(setRun);
  });
  return (
    <View className="page">
      <View className="title">故事局已创建</View>
      <Text className="subtitle">邀请码</Text>
      <View className="card">
        <View className="title">{run?.inviteCode || "------"}</View>
        <Text className="subtitle">{run?.title}</Text>
      </View>
      <Button className="button" onClick={() => nav(`/pages/roles/index?runId=${runId}`)}>选择角色</Button>
      <Button className="button secondary" onClick={() => nav(`/pages/room/index?runId=${runId}`)}>进入故事局</Button>
    </View>
  );
}
