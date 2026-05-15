# Error Summary
Generated: 05/14/2026 21:43:46


## backend-api-test.log
- Line 10: + CategoryInfo          : NotSpecified: ((node:3608) [MO...se as CommonJS.:String) [], RemoteException
- Line 11: + FullyQualifiedErrorId : NativeCommandError

## backend-test.log
- Line 10: + CategoryInfo          : NotSpecified: ((node:28948) [M...se as CommonJS.:String) [], RemoteException
- Line 11: + FullyQualifiedErrorId : NativeCommandError

## baseline-preview-api.err.log
- Line 2: throw er; // Unhandled 'error' event
- Line 5: Error: listen EADDRINUSE: address already in use 0.0.0.0:3001
- Line 10: Emitted 'error' event on Server instance at:
- Line 11: at emitErrorNT (node:net:1976:8)

## baseline-preview-api.log
- Line 5: ELIFECYCLE  Command failed with exit code 1.

## db-docker-context.log
- Line 1: NAME              DESCRIPTION                               DOCKER ENDPOINT                             ERROR

## db-docker-info.log
- Line 50: docker.exe : failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is cor
- Line 55: + CategoryInfo          : NotSpecified: (failed to conne...file specified.:String) [], RemoteException
- Line 56: + FullyQualifiedErrorId : NativeCommandError

## db-docker-ps.log
- Line 1: docker : failed to connect to the docker API at npipe:////./pipe/dockerDesktopLinuxEngine; check if the path is correct
- Line 6: + CategoryInfo          : NotSpecified: (failed to conne...file specified.:String) [], RemoteException
- Line 7: + FullyQualifiedErrorId : NativeCommandError

## deepseek-nokey-ai-task.json
- Line 7: "status":  "failed",
- Line 18: "errorCode":  "deepseek_runtime_unavailable",
- Line 19: "errorMessage":  "DEEPSEEK_API_KEY is required when AI_DIRECTOR_PROVIDER=deepseek",

## frontend-miniprogram-build.log
- Line 15: + CategoryInfo          : NotSpecified: (:String) [], RemoteException
- Line 16: + FullyQualifiedErrorId : NativeCommandError

## manual-story-e2e-preview.log
- Line 6: ELIFECYCLE  Command failed with exit code 4294967295.

## web-cabin-app-js.txt
- Line 138: lastError: null,
- Line 264: state.lastError = response.ok ? null : data;
- Line 265: if (!response.ok) throw new Error(data?.message || `${response.status} ${path}`);
- Line 274: } catch (error) {
- Line 275: showError(error);
- Line 276: throw error;
- Line 360: if (!state.run?.id) throw new Error("请先创建测试局");
- Line 397: if (!node || !role) throw new Error("请先创建测试局并选择角色");
- Line 425: if (!node) throw new Error("缺少当前节点");
- Line 454: if (!node) throw new Error("缺少当前节点");
- Line 460: if (!state.run?.id) throw new Error("请先创建测试局");
- Line 472: if (!state.run?.id) throw new Error("请先创建测试局");
- Line 497: lastError: null,
- Line 900: lastError: state.lastError,
- Line 958: function showError(error) {
- Line 959: state.lastError = { message: error?.message || String(error) };
- Line 966: loadTemplates().catch(showError);

## web-cabin-browser-summary.json
- Line 40: "lastError": null
- Line 42: "blockingRuntimeErrorCount": 0,
- Line 43: "runtimeErrors": []

## web-cabin-browser.log
- Line 40: "lastError": null
- Line 42: "blockingRuntimeErrorCount": 0,
- Line 43: "runtimeErrors": []
