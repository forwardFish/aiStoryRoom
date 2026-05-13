import { Button, Text, View } from "@tarojs/components";
import { nav } from "../../lib/api";

export default function ModePage() {
  return (
    <View className="page">
      <View className="title">选择模式</View>
      <Text className="subtitle">选择你想怎样开始第一章。</Text>
      <View className="card">
        <Text>创建故事局</Text>
        <Text className="subtitle">和朋友一起开局，2-5 人邀请。</Text>
        <Button className="button" onClick={() => nav("/pages/templates/index?mode=invite")}>选择模板</Button>
      </View>
      <View className="card">
        <Text>单人试玩</Text>
        <Text className="subtitle">AI 托管其他角色，快速跑通一章。</Text>
        <Button className="button" onClick={() => nav("/pages/templates/index?mode=single")}>开始试玩</Button>
      </View>
    </View>
  );
}
