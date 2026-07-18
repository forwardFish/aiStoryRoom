import { Body, Controller, Get, HttpException, HttpStatus, Inject, Param, Post, ServiceUnavailableException, UseGuards } from "@nestjs/common";
import type { CreateStoryRunInput, MockLoginInput, SubmitActionInput } from "@ai-story/shared";
import { AdminGuard } from "./auth/admin.guard";
import { AuthGuard } from "./auth/auth.guard";
import { CurrentUser, type AuthenticatedUser } from "./auth/current-user.decorator";
import { Public } from "./auth/public.decorator";
import { LegacyStoryAccessGuard } from "./auth/legacy-story-access.guard";
import { creemConfigurationReadiness } from "./billing/creem.client";
import { EmailService } from "./email/email.service";
import { PrismaService } from "./prisma.service";
import { StoryService } from "./story.service";

const deploymentVersion = () => process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || "local";

@Controller()
@UseGuards(AuthGuard, LegacyStoryAccessGuard)
export class StoryController {
  constructor(@Inject(StoryService) private readonly story: StoryService, @Inject(PrismaService) private readonly prisma: PrismaService, @Inject(EmailService) private readonly email: EmailService) {}

  @Get()
  @Public()
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
  @Public()
  health() {
    return { ok: true, service: "ai-story-room-api", version: deploymentVersion() };
  }

  @Get("health/live")
  @Public()
  live() { return { ok: true, service: "ai-story-room-api", status: "live", version: deploymentVersion() }; }

  @Get("health/ready")
  @Public()
  async ready() {
    const [database, email] = await Promise.all([this.prisma.readiness(), Promise.resolve(this.email.readiness())]);
    const billing = creemConfigurationReadiness();
    if (!database.ready || !email.ready || !billing.ready) throw new ServiceUnavailableException({ code: "DEPENDENCY_NOT_READY", database, email, billing });
    return { ok: true, service: "ai-story-room-api", status: "ready", version: deploymentVersion(), database, email, billing };
  }

  @Post("auth/wechat-login")
  @Public()
  login(@Body() body: MockLoginInput) {
    return this.story.login(body);
  }

  @Get("user/me")
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.story.me(user.openid);
  }

  @Post("user/agree-policy")
  agreePolicy(@CurrentUser() user: AuthenticatedUser) {
    return this.story.agreePolicy(user.openid);
  }

  @Get("world-templates")
  @Public()
  templates() {
    return this.story.templates();
  }

  @Get("world-templates/:templateId")
  @Public()
  template(@Param("templateId") templateId: string) {
    return this.story.template(templateId);
  }

  @Post("v4/story-runs")
  createMvpRun(@Body() body: Record<string, unknown>) {
    const mode = String(body.mode || "single").toLowerCase();
    if (mode !== "single" && mode !== "solo") {
      throw new HttpException({ code: "ROOM_CREATE_REQUIRES_LOBBY", message: "Create multiplayer rooms through /api/v4/rooms" }, HttpStatus.BAD_REQUEST);
    }
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

  @Post("v4/story-runs/:runId/critical-events/:eventId/respond")
  startMvpCriticalResponse(
    @Param("runId") runId: string,
    @Param("eventId") eventId: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.story.startMvpCriticalResponse(runId, eventId, body);
  }

  @Post("v4/story-runs/:runId/messages/:messageId/defer")
  deferMvpCriticalEvent(
    @Param("runId") runId: string,
    @Param("messageId") messageId: string,
    @Body() body: Record<string, unknown>
  ) {
    return this.story.deferMvpCriticalEvent(runId, messageId, body);
  }

  @Post("v4/story-runs/:runId/maneuvers")
  async submitMvpManeuver(@Param("runId") runId: string, @Body() body: Record<string, unknown>) {
    const result = await this.story.submitMvpManeuver(runId, body) as any;
    if (result?.accepted === false && result.code === "ACTION_BLOCKED") {
      throw new HttpException(result, HttpStatus.UNPROCESSABLE_ENTITY);
    }
    return result;
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
  createRun(@CurrentUser() user: AuthenticatedUser, @Body() body: CreateStoryRunInput) {
    if (body.mode === "room") throw new HttpException({ code: "ROOM_CREATE_REQUIRES_LOBBY", message: "Create multiplayer rooms through /api/v4/rooms" }, HttpStatus.BAD_REQUEST);
    return this.story.createRun(user.openid, body);
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
  myRuns(@CurrentUser() user: AuthenticatedUser) {
    return this.story.myRuns(user.openid);
  }

  @Post("story-runs/:runId/join")
  joinRun(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.story.joinRun(user.openid, runId);
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
    @CurrentUser() user: AuthenticatedUser,
    @Param("runId") runId: string,
    @Param("roleId") roleId: string
  ) {
    return this.story.claimRole(user.openid, runId, roleId);
  }

  @Get("story-runs/:runId/my-role")
  myRole(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.story.myRole(user.openid, runId);
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
    @CurrentUser() user: AuthenticatedUser,
    @Param("nodeId") nodeId: string,
    @Body() body: SubmitActionInput
  ) {
    return this.story.submitAction(user.openid, nodeId, body);
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
  shareChapter(@CurrentUser() user: AuthenticatedUser, @Param("chapterId") chapterId: string) {
    return this.story.shareChapter(user.openid, chapterId);
  }

  @Get("notifications")
  notifications(@CurrentUser() user: AuthenticatedUser) {
    return this.story.notifications(user.openid);
  }

  @Post("feedback/report")
  reportFeedback(@CurrentUser() user: AuthenticatedUser, @Body() body: Record<string, unknown>) {
    return this.story.reportFeedback(user.openid, body);
  }

  @Get("story-runs/:runId/insights")
  insights(@CurrentUser() user: AuthenticatedUser, @Param("runId") runId: string) {
    return this.story.insights(user.openid, runId);
  }

  @Get("admin/dashboard")
  @UseGuards(AdminGuard)
  adminDashboard() {
    return this.story.adminDashboard();
  }

  @Get("admin/story-runs")
  @UseGuards(AdminGuard)
  adminStoryRuns() {
    return this.story.adminStoryRuns();
  }

  @Get("admin/story-runs/:runId")
  @UseGuards(AdminGuard)
  adminStoryRun(@Param("runId") runId: string) {
    return this.story.adminStoryRun(runId);
  }

  @Get("admin/roles")
  @UseGuards(AdminGuard)
  adminRoles() {
    return this.story.adminRoles();
  }

  @Get("admin/actions")
  @UseGuards(AdminGuard)
  adminActions() {
    return this.story.adminActions();
  }

  @Get("admin/resolutions")
  @UseGuards(AdminGuard)
  adminResolutions() {
    return this.story.adminResolutions();
  }

  @Get("admin/ai-tasks")
  @UseGuards(AdminGuard)
  adminAiTasks() {
    return this.story.adminAiTasks();
  }

  @Get("admin/audit-logs")
  @UseGuards(AdminGuard)
  adminAuditLogs() {
    return this.story.adminAuditLogs();
  }

  @Get("admin/event-logs")
  @UseGuards(AdminGuard)
  adminEventLogs() {
    return this.story.adminEventLogs();
  }

  @Get("admin/action-guard")
  @UseGuards(AdminGuard)
  adminActionGuard() {
    return this.story.adminActionGuard();
  }
}
