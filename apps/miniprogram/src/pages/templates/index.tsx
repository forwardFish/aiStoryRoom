import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav } from "../../lib/api";

export default function TemplatesPage() {
  const router = useRouter();
  const mode = String(router.params.mode || "single");
  const [templates, setTemplates] = useState<any[]>([]);
  useDidShow(() => {
    api<any[]>("/world-templates").then(setTemplates);
  });
  return (
    <View className="page">
      <View className="title">选择世界模板</View>
      <Text className="subtitle">第一版推荐从午夜便利店开始。</Text>
      {templates.map((template) => (
        <View className="card" key={template.id}>
          <View className="row">
            <Text>{template.name}</Text>
            <Text className="tag">{template.genre}</Text>
          </View>
          <Text className="subtitle">{template.hook}</Text>
          <Button className="button" onClick={() => nav(`/pages/create-run/index?templateId=${template.id}&mode=${mode}`)}>选中这个世界</Button>
        </View>
      ))}
    </View>
  );
}
