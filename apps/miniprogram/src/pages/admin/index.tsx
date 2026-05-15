import { Text, View } from "@tarojs/components";
import { useDidShow } from "@tarojs/taro";
import { useState } from "react";
import { api } from "../../lib/api";

export default function AdminPage() {
  const [dashboard, setDashboard] = useState<any>();
  const [runs, setRuns] = useState<any[]>([]);
  const [aiTasks, setAiTasks] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [eventLogs, setEventLogs] = useState<any[]>([]);
  useDidShow(() => {
    api<any>("/admin/dashboard").then(setDashboard);
    api<any[]>("/admin/story-runs").then(setRuns);
    api<any[]>("/admin/ai-tasks").then(setAiTasks);
    api<any[]>("/admin/audit-logs").then(setAuditLogs);
    api<any[]>("/admin/event-logs").then(setEventLogs);
  });
  return (
    <View className="page">
      <Text className="subtitle">admin_01_dashboard.png / admin_02_story_runs.png / admin_03_ai_logs.png / admin_04_content_audit.png</Text>
      <View className="title">后台基础查看</View>
      <View className="card">
        <Text className="label">Dashboard</Text>
        <View className="tag">活跃故事局 {dashboard?.activeRuns || 0}</View>
        <View className="tag">待处理 AI {dashboard?.pendingAiTasks || 0}</View>
        <View className="tag">审核问题 {dashboard?.auditIssues || 0}</View>
        <View className="tag">事件数 {dashboard?.eventCount || 0}</View>
      </View>
      <View className="card">
        <Text className="label">故事局 / 角色</Text>
        {runs.map((run) => <View key={run.id} className="card compact"><Text>{run.title}</Text><Text className="subtitle">{run.status} / 已完成节点 {run.completedNodeCount || 0}</Text></View>)}
      </View>
      <View className="card">
        <Text className="label">AI 任务</Text>
        {aiTasks.map((task) => <View key={task.id} className="tag">{task.taskType}:{task.status}</View>)}
      </View>
      <View className="card">
        <Text className="label">审核日志 / ActionGuard</Text>
        {auditLogs.map((log) => <View key={log.id} className="tag">{log.targetType}:{log.result}</View>)}
      </View>
      <View className="card">
        <Text className="label">EventLog</Text>
        {eventLogs.map((log) => <View key={log.id} className="tag">{log.eventName}</View>)}
      </View>
    </View>
  );
}
