import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { assertPlayableMvpRole, getMvpStory, getMvpStoryRoles, listMvpStories } from "./mvp-catalog";
import { StoryService } from "./story.service";

@Controller("v4/stories")
export class MvpCatalogController {
  constructor(@Inject(StoryService) private readonly story: StoryService) {}

  @Get()
  list() {
    return listMvpStories();
  }

  @Get(":storyId/roles")
  roles(@Param("storyId") storyId: string) {
    return { storyId, roles: getMvpStoryRoles(storyId) };
  }

  @Post(":storyId/runs")
  createRun(@Param("storyId") storyId: string, @Body() body: Record<string, unknown>) {
    const roleKey = String(body.roleKey || "zhejiang_governor");
    const role = assertPlayableMvpRole(storyId, roleKey);
    return this.story.createMvpRun({ ...body, storyId, roleKey: role.key, mode: "single" });
  }

  @Get(":storyId")
  detail(@Param("storyId") storyId: string) {
    return getMvpStory(storyId);
  }
}
