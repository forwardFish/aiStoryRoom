import { Button, Input, Picker, Text, Textarea, View } from "@tarojs/components";
import { useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav, redirect } from "../../lib/api";

const actionTypes = ["observe", "investigate", "ask", "cooperate", "confront", "custom"];
const riskLevels = ["safe", "normal", "risky"];

export default function ActionPage() {
  const router = useRouter();
  const runId = String(router.params.runId || "");
  const nodeId = String(router.params.nodeId || "");
  const roleId = String(router.params.roleId || "");
  const [actionType, setActionType] = useState("observe");
  const [riskLevel, setRiskLevel] = useState("normal");
  const [targetText, setTargetText] = useState("监控回放");
  const [method, setMethod] = useState("我准备查看最近十分钟监控，重点观察自动门附近。");
  const [intent, setIntent] = useState("确认没有影子的客人是否真实进入便利店。");
  const [message, setMessage] = useState("");

  async function submit() {
    const result = await api<any>(`/nodes/${nodeId}/actions`, {
      method: "POST",
      data: { runId, roleId, actionType, targetText, method, intent, riskLevel, freeText: "" }
    });
    setMessage(result.message || result.status);
    if (result.status === "accepted") {
      await redirect(`/pages/resolution/index?runId=${runId}&nodeId=${nodeId}`);
    }
  }

  return (
    <View className="page">
      <View className="title">提交角色行动</View>
      <Text className="subtitle">你不用写小说，只要说明你的角色想做什么。</Text>
      <View className="card">
        <Text className="label">行动类型</Text>
        <Picker mode="selector" range={actionTypes} onChange={(event) => setActionType(actionTypes[Number(event.detail.value)])}>
          <View className="input">{actionType}</View>
        </Picker>
        <Text className="label">行动对象</Text>
        <Input className="input" value={targetText} onInput={(event) => setTargetText(String(event.detail.value))} />
        <Text className="label">行动方式</Text>
        <Textarea className="input" value={method} onInput={(event) => setMethod(String(event.detail.value))} />
        <Text className="label">行动目的</Text>
        <Textarea className="input" value={intent} onInput={(event) => setIntent(String(event.detail.value))} />
        <Text className="label">风险档位</Text>
        <Picker mode="selector" range={riskLevels} value={1} onChange={(event) => setRiskLevel(riskLevels[Number(event.detail.value)])}>
          <View className="input">{riskLevel}</View>
        </Picker>
      </View>
      {message ? <View className="card danger"><Text>{message}</Text><Button className="button secondary" onClick={() => nav(`/pages/insight/index?runId=${runId}&kind=actionguard`)}>?? ActionGuard ??</Button></View> : null}
      <Button className="button" onClick={submit}>提交行动</Button>
    </View>
  );
}
