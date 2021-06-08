const express = require("express");
const { App, LogLevel, ExpressReceiver } = require("@slack/bolt");
const config = require("config");

const PipelineUpdateHandler = require("./handlers/PipelineUpdateHandler");
const Go = require("./services/go");
const Pipeline = require("./models/Pipeline");

const receiver = new ExpressReceiver({
    signingSecret: config.get("slack.signingSecret"),
});

const app = new App({
    token: config.get("slack.token"),
    signingSecret: config.get("slack.signingSecret"),
    receiver,
    // logLevel: LogLevel.DEBUG,
});

app.action({ callback_id: "build_response" }, async ({ action, say, ack }) => {
    console.log("build_response with action", action);
    await ack(); // Tell them we received this
    const payload = JSON.parse(action.value);

    let msg = "Error, invalid payload";
    if (action.name === "rerun") {
        const result = await Go.runFailedJobs(payload.uri);
        msg = (result?.message || "Error triggering build") + ` for ${payload.name}`;
    }

    if (action.name === "output" && payload.jobs?.length > 0) {
        const [pipelineData, stageHistory] = await Promise.all([
            Go.fetchPipelineInstance(payload.name),
            Go.fetchStageHistory(payload.pipeline, payload.stage),
        ]);
        if (pipelineData && stageHistory.stages) {
            pipelineData.stage = stageHistory.stages.find((s) => s.counter == payload.counter);
            const pipeline = new Pipeline(pipelineData);
            const handler = new PipelineUpdateHandler();
            await handler.parseFailures(pipeline, true);
            msg = pipeline.get("failures") ? `Detail error output\n` : "Error processing failures";
            pipeline.get("failures")?.forEach((failure) => {
                const failureMsg = failure.replace(/^\s*\n/gm, ""); // Trim empty lines
                msg += "```" + failureMsg + "``` ";
            });
        }
    }

    await say(msg);
});

const handlers = [PipelineUpdateHandler];

receiver.router.post("/api/webhooks", express.json(), async (request, response) => {
    const Handler = handlers.find((Handler) => {
        return Handler.shouldHandle(request);
    });

    if (Handler) {
        await new Handler(app).handle(request).catch((error) => {
            console.error(error);
        });
    }

    response.send({ status: "OK" });
});

receiver.router.post("/api/actions", express.json(), async (request, response) => {
    console.log(request.body);
});

app.start(3000).then(() => {
    console.log("Bot is running on port 3000");
});
