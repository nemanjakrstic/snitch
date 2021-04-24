const path = require("path");
const Pipeline = require("../models/Pipeline");
const PipelineFailedNotification = require("../templates/PipelineFailedNotification");
const config = require("config");
const Handler = require("./Handler");
const Go = require("../services/go");

class PipelineUpdateHandler extends Handler {
    static shouldHandle(request) {
        return !!request.body?.pipeline;
    }

    async parseFailures(pipeline, detail = false) {
        const failedJobs = pipeline.getFailedJobs();
        if (failedJobs.length === 0 || failedJobs.length > 10) {
            console.log(`Not enough or Too many failures, not going to get failures Count: ${failedJobs.length}`);
            return;
        }

        const failures = new Set();
        const junitJobs = await pipeline.getJunitJSON();
        junitJobs.forEach((junit) => {
            const testCaseList = junit.suites.map((suite) => {
                const hasErrors = suite.errors > 0 || suite.failures > 0;
                return hasErrors ? suite.testCases.filter((tc) => tc.type === "error" || tc.type === "failure") : [];
            });

            testCaseList.forEach((testCases) => {
                testCases.forEach((tc) => {
                    let line;
                    if (tc.file) {
                        line = `${path.basename(tc.file)} Line: ${tc.line}\n`;
                        if (detail) {
                            tc.messages.values.forEach((m) => {
                                const lines = m.value.split("\n").slice(0, 5);
                                lines.forEach((l) => (line += `${' '.repeat(4) + l}\n`));
                            });
                        } else {
                            line += `\n    ${tc.name}`;
                        }
                        line += "\n";
                    } else if (tc.className) {
                        line = `${tc.classname}`;
                    }

                    line && failures.add(line);
                });
            });
        });

        console.log("parsed failures", failures.size, failures);
        failures.size > 0 && pipeline.set("failures", failures);
    }

    async handle(request) {
        const pipeline = new Pipeline(request.body.pipeline);

        if (!(await pipeline.shouldNotify())) {
            return;
        }

        if (pipeline.hasSucceeded()) {
            const isFullyGreen = await Go.isEntirePipelineGreen(pipeline.getName());
            pipeline.set("isFullyGreen", isFullyGreen);
            if (!isFullyGreen) {
                return;
            }
        }

        await this.parseFailures(pipeline);

        let emails = new Set([pipeline.getCommitterEmail()]);
        if (pipeline.getApprovedByEmail()) {
            emails.add(pipeline.getApprovedByEmail());
        }

        emails.forEach((email) => this.doNotify(pipeline, email));
    }

    async doNotify(pipeline, email) {
        if (email === "noreply@github.com") {
            console.log(`${email} skipping`);
            return false;
        }

        let user = await this.getChannelByEmail(email);
        if (!user) {
            return;
        }

        user.id = "U02C4K1BF"; // To debug. Rushi's ID
        console.log(`Notify ${pipeline.getCommitterName()} ${email} ${JSON.stringify(user)}`);

        const notification = await new PipelineFailedNotification(pipeline, user).toJSON();
        await this.app.client.chat.postMessage({
            token: config.get("slack.token"),
            channel: user.id,
            ...notification,
        });
    }

    async getChannelByEmail(email) {
        try {
            const result = await this.app.client.users.lookupByEmail({
                token: config.get("slack.token"),
                email,
            });
            if (result) {
                return { id: result.user?.id, name: result.user?.real_name, avatar: result.user?.profile?.image_192 };
            }
        } catch (err) {
            console.log("Error finding user", err.message);
        }

        return null;
    }
}

module.exports = PipelineUpdateHandler;
