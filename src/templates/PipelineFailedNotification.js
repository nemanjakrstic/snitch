const Pipeline = require("../models/Pipeline");
const Go = require("../services/go");

class PipelineFailedNotification {
    /**
     * @param {Pipeline} pipeline
     */
    constructor(pipeline, user) {
        this.pipeline = pipeline;
        this.user = user;
    }

    getColor() {
        if (this.pipeline.get("stage.state") === Pipeline.STAGE_CANCELLED) {
            return "#ffc03d"; // Yellow
        }

        if (this.pipeline.get("stage.state") === Pipeline.STAGE_FAILED) {
            return "#ff5a5a"; // Red
        }

        if (this.pipeline.get("isFullyGreen")) {
            return "#00FF7F"; // Green
        }

        if (this.pipeline.get("stage.state") === Pipeline.STAGE_PASSED) {
            return "#27ce70"; // Another Green
        }

        return "#1352c6"; // Blue
    }

    async toJSON() {
        const { pipeline } = this;

        const fields = [];

        // Jira link and emails that committed and triggered the build
        const jira = pipeline.getTicketNumber() ? `<${pipeline.getTicketUrl()}|${pipeline.getTicketNumber()}>` : null;

        // Special message if the build is fully green
        const state = this.pipeline.get("stage.state", "").toLowerCase();
        let pretext = `${jira} Pipeline stage *${state}*`;
        console.log("isFullyGreen", this.pipeline.get("isFullyGreen"));
        if (this.pipeline.get("isFullyGreen")) {
            pretext = `:partyparrot: ${jira} Pipeline *${this.pipeline.get("name")}* is *fully green*`;
        }
        pretext += ` <${pipeline.getUrl()}|${pipeline.getUri()}>`;

        // Create an empty line
        const emptyLine = { title: ``, value: "", short: true };
        fields.push(emptyLine, emptyLine);

        const failures = pipeline.get("failures");
        const failedJobs = pipeline.getFailedJobs();
        let failedTestsCount = 0;
        const failedJobsOutputLimit = 10;
        if (failedJobs.length > 0) {
            let message = failedJobs
                .slice(0, failedJobsOutputLimit)
                .map((j) => `<${pipeline.getJobUrl(j.name)}|${j.name}>`)
                .join(", ");

            if (failedJobs.length > 10) {
                message += ` and *${failedJobs.length - 10}* more jobs :scream:`;
            } else {
                failures?.forEach((failure) => {
                    const failureMsg = failure.replace(/^\s*\n/gm, ""); // Trim empty lines
                    message += "```" + failureMsg + "``` ";
                    failedTestsCount++;
                });
            }

            fields.push({ title: `Failed Jobs (${failedJobs.length})`, value: message });
        }

        const emails = [`Committed By: ${pipeline.getCommitterEmail()}`];
        if (pipeline.getApprovedByEmail() && pipeline.getApprovedByEmail() !== pipeline.getCommitterEmail()) {
            emails.push(`Triggered by: ${pipeline.getApprovedByEmail()}`);
        }

        let footer = `Status: ${pipeline.get("stage.result")}, well done`;
        if (pipeline.hasFailed()) {
            footer = `Status: ${pipeline.getFailedJobs().length} jobs & ${failedTestsCount} tests failed`;
        } else if (this.pipeline.get("isFullyGreen")) {
            footer = `Status: Fully successful`;
        }

        const actions = [];
        const rerunAction = {
            name: "rerun",
            text: ":repeat: Rerun Failed",
            type: "button",
            value: JSON.stringify({
                name: pipeline.getUri(),
                stage: pipeline.getStageName(),
                counter: pipeline.get("counter"),
                uri: this.pipeline.getRerunUri(),
            }),
        };

        if (failedJobs.length > 0 && failedJobs.length < 20 && pipeline.get('counter') < 10) {
            // Only give the re-run option if this build has been re-run fewer than 10 times
            // Force the engineer to re-check Go and not keep clicking this button
            actions.push(rerunAction);
        }

        if (failedJobs.length > 0 && failedJobs.length < failedJobsOutputLimit) {
            actions.push({
                name: "output",
                text: `:pencil: Show Full Results`,
                type: "button",
                value: JSON.stringify({
                    pipeline: pipeline.get("name"),
                    name: pipeline.getName(),
                    counter: pipeline.get('stage.counter'),
                    stage: pipeline.get("stage.name"),
                    jobs: failedJobs.map((j) => j.name),
                }),
            });
        }

        // console.log('actions', actions);

        return {
            attachments: [
                {
                    mrkdwn_in: ["text", "pretext"],
                    color: this.getColor(),
                    pretext: pretext.trim(),
                    author_name: this.user.name,
                    author_icon: this.user.avatar,
                    title: `${pipeline.getCommitHash()} ${pipeline.getCommitMessage()}`,
                    title_link: pipeline.getCommitUrl(),
                    text: emails.join(" "),
                    fields,
                    footer,
                    actions,
                    callback_id: "build_response",
                },
            ],
        };
    }
}

module.exports = PipelineFailedNotification;
