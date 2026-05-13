import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav } from "../../lib/api";

export default function RoomPage() {
  const runId = String(useRouter().params.runId || "");
  const [state, setState] = useState<any>();
  const [myRole, setMyRole] = useState<any>();
  function load() {
    api<any>(`/story-runs/${runId}/state`).then(setState);
    api<any>(`/story-runs/${runId}/my-role`).then(setMyRole).catch(() => undefined);
  }
  useDidShow(load);
  const node = state?.currentNode;
  return (
    <View className="page">
      <View className="row">
        <View className="title">故事局房间</View>
        <Text className="tag">危险 {state?.run?.dangerLevel || 1}/5</Text>
      </View>
      <View className="card">
        <Text className="label">当前剧情</Text>
        <Text className="subtitle">{node?.publicNarration}</Text>
        <Text className="label">当前目标</Text>
        <Text>{node?.nodeGoal}</Text>
      </View>
      <View className="card">
        <Text>我的角色：{myRole?.role?.roleName || "未选择"}</Text>
        <Text className="subtitle">{myRole?.role?.personalGoal}</Text>
        <Text className="label">????</Text>
        <Text>{myRole?.role?.destinyQuestion}</Text>
      </View>
      <View className="card">
        <Text>已知线索</Text>
        {(state?.clues || []).map((clue: any) => (
          <View key={clue.id} className="tag">{clue.title}</View>
        ))}
      </View>
      <Button className="button" onClick={() => nav(`/pages/action/index?runId=${runId}&nodeId=${node?.id}&roleId=${myRole?.role?.id}`)}>提交行动</Button>
      <Button className="button secondary" onClick={() => nav(`/pages/resolution/index?runId=${runId}&nodeId=${node?.id}`)}>推进/查看结算</Button>
    </View>
  );
}
