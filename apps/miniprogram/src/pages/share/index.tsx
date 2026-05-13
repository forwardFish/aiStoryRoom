import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav } from "../../lib/api";

export default function SharePage() {
  const chapterId = String(useRouter().params.chapterId || "");
  const [share, setShare] = useState<any>();
  useDidShow(() => {
    if (chapterId) api<any>(`/chapters/${chapterId}/share`, { method: "POST" }).then(setShare);
  });
  return (
    <View className="page">
      <View className="title">分享本章</View>
      <View className="card">
        <Text>没有影子的客人</Text>
        <Text className="subtitle">和朋友一起玩出一章小说。</Text>
        <Text className="tag">分享码 {share?.token}</Text>
      </View>
      <Button className="button">保存分享卡</Button>
    </View>
  );
}
