import { Button, Input, Picker, Text, View } from "@tarojs/components";
import { useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, redirect } from "../../lib/api";

export default function CreateRunPage() {
  const router = useRouter();
  const templateId = String(router.params.templateId || "template_midnight_store_001");
  const mode = String(router.params.mode || "single");
  const [maxPlayers, setMaxPlayers] = useState(mode === "single" ? 1 : 3);
  const [tone, setTone] = useState("悬疑");

  async function createRun() {
    const run = await api<any>("/story-runs", {
      method: "POST",
      data: {
        templateId,
        mode,
        maxPlayers,
        aiPlayerCount: mode === "single" ? Math.max(0, 3 - maxPlayers) : 0,
        tone,
        ownerAsPlayer: true
      }
    });
    await redirect(`/pages/lobby/index?runId=${run.id}`);
  }

  return (
    <View className="page">
      <View className="title">创建故事局</View>
      <Text className="subtitle">配置第一章沙盒和玩家人数。</Text>
      <View className="card">
        <Text className="label">故事氛围</Text>
        <Input className="input" value={tone} onInput={(event) => setTone(String(event.detail.value))} />
        <Text className="label">参与人数</Text>
        <Picker mode="selector" range={[1, 2, 3, 4, 5]} value={maxPlayers - 1} onChange={(event) => setMaxPlayers(Number(event.detail.value) + 1)}>
          <View className="input">{maxPlayers} 人</View>
        </Picker>
        <Button className="button" onClick={createRun}>创建故事局</Button>
      </View>
    </View>
  );
}
