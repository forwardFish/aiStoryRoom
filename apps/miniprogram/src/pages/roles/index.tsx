import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav, redirect } from "../../lib/api";

export default function RolesPage() {
  const runId = String(useRouter().params.runId || "");
  const [roles, setRoles] = useState<any[]>([]);
  useDidShow(() => {
    api<any[]>(`/story-runs/${runId}/roles`).then(setRoles);
  });

  async function claim(roleId: string) {
    await api(`/story-runs/${runId}/roles/${roleId}/claim`, { method: "POST" });
    await redirect(`/pages/role-card/index?runId=${runId}&roleId=${roleId}`);
  }

  return (
    <View className="page">
      <View className="title">选择你的角色</View>
      {roles.map((role) => (
        <View className="card" key={role.id}>
          <View className="row">
            <Text>{role.roleName}</Text>
            <Text className="tag">{role.identity}</Text>
          </View>
          <Text className="subtitle">{role.publicInfo}</Text>
          <Button className="button secondary" onClick={() => nav(`/pages/role-card/index?runId=${runId}&roleId=${role.id}`)}>查看角色卡</Button>
          <Button className="button" onClick={() => claim(role.id)}>确认选择 {role.roleName}</Button>
        </View>
      ))}
    </View>
  );
}
