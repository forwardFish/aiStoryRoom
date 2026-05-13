import { Button, Text, View } from "@tarojs/components";
import { useDidShow, useRouter } from "@tarojs/taro";
import { useState } from "react";
import { api, nav } from "../../lib/api";

export default function ChapterPage() {
  const router = useRouter();
  const chapterId = String(router.params.chapterId || "");
  const runId = String(router.params.runId || "");
  const [chapter, setChapter] = useState<any>();
  useDidShow(() => {
    if (chapterId) api<any>(`/chapters/${chapterId}`).then(setChapter);
    else api<any>(`/story-runs/${runId}/state`).then((state) => state.chapters?.[0] && api<any>(`/chapters/${state.chapters[0].id}`).then(setChapter));
  });
  return (
    <View className="page">
      <View className="title">{chapter?.title || "章节正文"}</View>
      <View className="card">
        <Text className="subtitle">{chapter?.content}</Text>
      </View>
      <View className="card">
        <Text>下一章预告</Text>
        <Text className="subtitle">{chapter?.nextHook}</Text>
      </View>
      <Button className="button" onClick={() => nav(`/pages/share/index?chapterId=${chapter?.id}`)}>分享故事卡</Button>
    </View>
  );
}
