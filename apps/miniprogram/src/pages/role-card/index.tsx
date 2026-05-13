import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, redirect } from "../../lib/api";

export default function RoleCardPage() {
  const router = useRouter();
  const runId = String(router.params.runId || "");
  const roleId = String(router.params.roleId || "");
  const [role, setRole] = useState<any>();
  useDidShow(() => {
    api<any[]>(`/story-runs/${runId}/roles`).then((roles) => setRole(roles.find((item) => item.id === roleId)));
  });
  return (
    <View className="page">
      <View className="title">角色卡</View>
      <View className="card">
        <View className="row">
          <Text>{role?.roleName}</Text>
          <Text className="tag">{role?.identity}</Text>
        </View>
        <Text className="label">公开信息</Text>
        <Text className="subtitle">{role?.publicInfo}</Text>
        <Text className="label">个人目标</Text>
        <Text className="subtitle">{role?.personalGoal}</Text>
        <Text className="label">隐藏秘密</Text>
        <Text className="subtitle danger">{role?.hiddenSecret}</Text>
        {(role?.privateClues || []).map((clue: string) => <View key={clue} className="tag">{clue}</View>)}
      </View>
      <Button className="button" onClick={() => redirect(`/pages/room/index?runId=${runId}`)}>进入故事局房间</Button>
    </View>
  );
}
