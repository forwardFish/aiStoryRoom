import Taro from "@tarojs/taro";

const apiBase = "http://localhost:3001/api";

export function getToken() {
  return Taro.getStorageSync("token") || "mock_openid_owner_001";
}

export function setToken(token: string) {
  Taro.setStorageSync("token", token);
}

export async function api<T>(path: string, options: { method?: "GET" | "POST"; data?: unknown } = {}): Promise<T> {
  const res = await Taro.request<T>({
    url: `${apiBase}${path}`,
    method: options.method || "GET",
    data: options.data,
    header: {
      "content-type": "application/json",
      authorization: `Bearer ${getToken()}`
    }
  });
  if (res.statusCode >= 400) {
    throw new Error(typeof res.data === "string" ? res.data : JSON.stringify(res.data));
  }
  return res.data;
}

export function nav(url: string) {
  return Taro.navigateTo({ url });
}

export function redirect(url: string) {
  return Taro.redirectTo({ url });
}
