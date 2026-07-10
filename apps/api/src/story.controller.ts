import { Body, Controller, Get, Headers, Inject, Param, Post } from "@nestjs/common";
import type { CreateStoryRunInput, MockLoginInput, SubmitActionInput } from "@ai-story/shared";
import { StoryService } from "./story.service";

@Controller()
export class StoryController {
  constructor(@Inject(StoryService) private readonly story: StoryService) {}

  @Get()
  index() {
    return {
      ok: true,
      name: "AI Story Room API",
      message: "API 正在运行。小程序请用微信开发者工具打开 apps/miniprogram。",
      endpoints: [
        "GET /api/health",
        "GET /api/world-templates",
        "POST /api/auth/wechat-login",
        "GET /api/my/story-runs"
      ]
    };
  }

  @Get("health")
  health() {
    return { ok: true, service: "ai-story-room-api" };
  }

  @Post("auth/wechat-login")
  login(@Body() body: MockLoginInput) {
    return this.story.login(body);
  }

  @Get("user/me")
  me(@Headers() headers: Record<string, string | undefined>) {
    return this.story.me(this.openid(headers));
  }

  @Post("user/agree-policy")
  agreePolicy(@Headers() headers: Record<string, string | undefined>) {
    return this.story.agreePolicy(this.openid(headers));
  }

  @Get("world-templates")
  templates() {
    return this.story.templates();
  }

  @Get("world-templates/:templateId")
  template(@Param("templateId") templateId: string) {
    return this.story.template(templateId);
  }

  @Post("v4/story-runs")
  createMvpRun(@Body() body: Record<string, unknown>) {
    return this.story.createMvpRun(body);
  }

  @Get("v4/story-runs/:runId")
  getMvpRun(@Param("runId") runId: string) {
    return this.story.getMvpRun(runId);
  }

  @Get("v4/story-runs/:runId/messages")
  getMvpMessages(@Param("runId") runId: string) {
    return this.story.getMvpMessages(runId);
  }

  @Get("v4/story-runs/:runId/dashboard")
  getMvpDashboard(@Param("runId") runId: string) {
    return this.story.getMvpDashboard(runId);
  }

  @Post("v4/story-runs/:runId/messages/:messageId/decisions")
  submitMvpDecision(
    @Param("runId") runId: string,
    @Param("messageId") messageId: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.story.submitMvpDecision(runId, messageId, body);
  }

  @Post("v4/story-runs/:runId/advance-day")
  advanceMvpDay(@Param("runId") runId: string, @Body() body: Record<string, unknown>) {
    return this.story.advanceMvpDay(runId, body);
  }

  @Post("v4/story-runs/:runId/finalize")
  finalizeMvpRun(@Param("runId") runId: string, @Body() body: Record<string, unknown>) {
    return this.story.finalizeMvpRun(runId, body);
  }

  @Post("story-runs")
  createRun(@Headers() headers: Record<string, string | undefined>, @Body() body: CreateStoryRunInput) {
    return this.story.createRun(this.openid(headers), body);
  }

  @Get("story-runs/:runId")
  getRun(@Param("runId") runId: string) {
    return this.story.getRun(runId);
  }

  @Get("story-runs/:runId/state")
  getRunState(@Param("runId") runId: string) {
    return this.story.getRunState(runId);
  }

  @Get("my/story-runs")
  myRuns(@Headers() headers: Record<string, string | undefined>) {
    return this.story.myRuns(this.openid(headers));
  }

  @Post("story-runs/:runId/join")
  joinRun(@Headers() headers: Record<string, string | undefined>, @Param("runId") runId: string) {
    return this.story.joinRun(this.openid(headers), runId);
  }

  @Post("story-runs/:runId/start")
  startRun(@Param("runId") runId: string) {
    return this.story.startRun(runId);
  }

  @Post("story-runs/:runId/pause")
  pauseRun(@Param("runId") runId: string) {
    return this.story.pauseRun(runId);
  }

  @Get("story-runs/:runId/roles")
  roles(@Param("runId") runId: string) {
    return this.story.roles(runId);
  }

  @Post("story-runs/:runId/roles/:roleId/claim")
  claimRole(
    @Headers() headers: Record<string, string | undefined>,
    @Param("runId") runId: string,
    @Param("roleId") roleId: string
  ) {
    return this.story.claimRole(this.openid(headers), runId, roleId);
  }

  @Get("story-runs/:runId/my-role")
  myRole(@Headers() headers: Record<string, string | undefined>, @Param("runId") runId: string) {
    return this.story.myRole(this.openid(headers), runId);
  }

  @Get("story-runs/:runId/current-node")
  currentNode(@Param("runId") runId: string) {
    return this.story.currentNode(runId);
  }

  @Get("story-runs/:runId/nodes")
  nodes(@Param("runId") runId: string) {
    return this.story.nodes(runId);
  }

  @Get("nodes/:nodeId")
  node(@Param("nodeId") nodeId: string) {
    return this.story.node(nodeId);
  }

  @Post("nodes/:nodeId/actions")
  submitAction(
    @Headers() headers: Record<string, string | undefined>,
    @Param("nodeId") nodeId: string,
    @Body() body: SubmitActionInput
  ) {
    return this.story.submitAction(this.openid(headers), nodeId, body);
  }

  @Get("nodes/:nodeId/actions")
  nodeActions(@Param("nodeId") nodeId: string) {
    return this.story.nodeActions(nodeId);
  }

  @Post("nodes/:nodeId/ai-fill-missing-actions")
  fillMissing(@Param("nodeId") nodeId: string) {
    return this.story.fillMissingActions(nodeId);
  }

  @Post("nodes/:nodeId/resolve")
  resolveNode(@Param("nodeId") nodeId: string) {
    return this.story.resolveNode(nodeId);
  }

  @Get("nodes/:nodeId/resolution")
  resolution(@Param("nodeId") nodeId: string) {
    return this.story.resolution(nodeId);
  }

  @Get("story-runs/:runId/narrative-segments")
  segments(@Param("runId") runId: string) {
    return this.story.segments(runId);
  }

  @Post("story-runs/:runId/generate-chapter")
  generateChapter(@Param("runId") runId: string) {
    return this.story.generateChapter(runId);
  }

  @Get("chapters/:chapterId")
  chapter(@Param("chapterId") chapterId: string) {
    return this.story.chapter(chapterId);
  }

  @Post("chapters/:chapterId/share")
  shareChapter(@Headers() headers: Record<string, string | undefined>, @Param("chapterId") chapterId: string) {
    return this.story.shareChapter(this.openid(headers), chapterId);
  }

  @Get("notifications")
  notifications(@Headers() headers: Record<string, string | undefined>) {
    return this.story.notifications(this.openid(headers));
  }

  @Post("feedback/report")
  reportFeedback(@Headers() headers: Record<string, string | undefined>, @Body() body: Record<string, unknown>) {
    return this.story.reportFeedback(this.openid(headers), body);
  }

  @Get("story-runs/:runId/insights")
  insights(@Headers() headers: Record<string, string | undefined>, @Param("runId") runId: string) {
    return this.story.insights(this.openid(headers), runId);
  }

  @Get("admin/dashboard")
  adminDashboard() {
    return this.story.adminDashboard();
  }

  @Get("admin/story-runs")
  adminStoryRuns() {
    return this.story.adminStoryRuns();
  }

  @Get("admin/story-runs/:runId")
  adminStoryRun(@Param("runId") runId: string) {
    return this.story.adminStoryRun(runId);
  }

  @Get("admin/roles")
  adminRoles() {
    return this.story.adminRoles();
  }

  @Get("admin/actions")
  adminActions() {
    return this.story.adminActions();
  }

  @Get("admin/resolutions")
  adminResolutions() {
    return this.story.adminResolutions();
  }

  @Get("admin/ai-tasks")
  adminAiTasks() {
    return this.story.adminAiTasks();
  }

  @Get("admin/audit-logs")
  adminAuditLogs() {
    return this.story.adminAuditLogs();
  }

  @Get("admin/event-logs")
  adminEventLogs() {
    return this.story.adminEventLogs();
  }

  @Get("admin/action-guard")
  adminActionGuard() {
    return this.story.adminActionGuard();
  }

  private openid(headers: Record<string, string | undefined>) {
    const auth = headers.authorization || "";
    return headers["x-mock-openid"] || auth.replace(/^Bearer\s+/i, "") || "mock_openid_owner_001";
  }
}
