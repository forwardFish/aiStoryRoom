import { Button, Text, View } from "@tarojs/components";
import { api, redirect, setToken } from "../../lib/api";

export default function LoginPage() {
  async function login() {
    const result = await api<{ token: string }>("/auth/wechat-login", {
      method: "POST",
      data: { mockOpenid: "mock_openid_owner_001", nickname: "本地测试用户" }
    });
    setToken(result.token);
    await redirect("/pages/home/index");
  }

  return (
    <View className="page">
      <Text className="subtitle">AI 多人故事局</Text>
      <View className="title">一起玩出一章小说</View>
      <Text className="subtitle">选择角色，做出行动，AI 导演把你们的选择写成故事。</Text>
      <View className="card">
        <Text>本地 MVP 使用 mock 微信授权登录，方便连接本地 API 和数据库。</Text>
      </View>
      <Button className="button" onClick={login}>微信一键登录</Button>
    </View>
  );
}
