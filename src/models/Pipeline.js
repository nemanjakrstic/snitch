const config = require("config");
const Model = require("./Model");
const _ = require("lodash");
const md5 = require("md5");
const jv = require("junit-viewer");
const Go = require("../services/go");

class Pipeline extends Model {
    static STAGE_FAILED = "Failed";
    static STAGE_CANCELLED = "Cancelled";
    static STAGE_PASSED = "Passed";
    static STAGE_UNKNOWN = "Unknown";

    getUri() {
        return [this.getName(), this.getStageName()].join("/");
    }

    getUrl() {
        return [config.get("go.url"), "go", "pipelines", this.getUri(), "jobs"].join("/");
    }

    getRerunUri() {
        const uri = [this.get("name"), this.get("label"), this.getStageName().trim("/"), "run-failed-jobs"];
        return `/go/api/stages/` + uri.join("/");
    }

    getName() {
        return [this.get("name"), this.get("counter")].join("/");
    }

    getStageName() {
        return [this.get("stage.name"), this.get("stage.counter")].join("/");
    }

    getCommitterName() {
        return this.get("build-cause.0.modifications.0.data.committerName");
    }

    getCommitterEmail() {
        return this.get("build-cause.0.modifications.0.data.committerEmail");
    }

    getCommitHash() {
        return this.get("build-cause.0.modifications.0.revision", "").substring(0, 7);
    }

    getApprovedByEmail() {
        const approvedBy = this.get("stage.approved-by");
        return approvedBy.indexOf("@") >= 0 ? approvedBy : null;
    }

    getCommitMessage() {
        const subject = this.get("build-cause.0.modifications.0.data.subject", "");
        const lines = subject.split("\n");
        return lines[0] === subject ? subject : lines[0] + "..."; // Append ellipsis if truncated
    }

    async shouldNotify() {
        const { state, result } = this.get("stage", {});

        if (result === Pipeline.STAGE_UNKNOWN) {
            return false;
        }

        if (this.hasFailed()) {
            return true;
        }

        return this.hasSucceeded();
    }

    hasSucceeded() {
        const { state, result } = this.get("stage", {});
        return state === Pipeline.STAGE_PASSED && result === Pipeline.STAGE_PASSED;
    }

    hasFailed() {
        const { result } = this.get("stage", {});
        return result === Pipeline.STAGE_FAILED || result === Pipeline.STAGE_CANCELLED;
    }

    getFailedJobs() {
        return this.get("stage.jobs", []).filter((job) => {
            return job.result === "Failed";
        });
    }

    getJobUrl(jobName) {
        const base = `/go/tab/build/detail/${this.getName()}/${this.getStageName()}/${jobName}`;
        return config.get("go.url") + base;
    }

    getRepoUrl() {
        const repoUrl = new URL(this.get("build-cause.0.material.git-configuration.url"));
        repoUrl.username = "";
        repoUrl.password = "";
        return _.trimEnd(repoUrl.toString(), ".git");
    }

    getCommitUrl() {
        return [this.getRepoUrl(), "commit", this.getCommitHash()].join("/");
    }

    getGitHubUser() {
        const repoUrl = new URL(this.getRepoUrl());
        return repoUrl.pathname.split("/")[1];
    }

    getCommitterAvatarUrl() {
        return `https://www.gravatar.com/avatar/${md5(this.getCommitterEmail())}`;
    }

    getTicketNumber() {
        let ticketNumer = this.getCommitMessage().match(/\b[A-Z]{2,3}-\d{1,5}\b/)?.[0];
        if (!ticketNumer) {
            ticketNumer = this.get("name").match(/\b[A-Z]{2,3}-\d{1,5}\b/)?.[0];
        }

        return ticketNumer;
    }

    getTicketUrl() {
        const ticket = this.getTicketNumber();
        return ticket ? [config.get("jira.url"), "browse", ticket].join("/") : null;
    }

    async getJunitJSON() {
        let failures = [{ suites: [] }];
        let failedJobs = this.getFailedJobs();
        if (!this.hasFailed() || failedJobs.length === 0) {
            return failures;
        }

        let promises = [];
        for (let fj of failedJobs) {
            const junitPromise = Go.getJunitFileForJob(this.getName(), this.getStageName(), fj.name);
            promises.push(junitPromise);
        }

        try {
            let allJunits = await Promise.all(promises);
            allJunits.forEach((junit) => {
                if (!junit) {
                    return;
                }
                try {
                    failures.push(jv.parseXML(junit));
                } catch (err) {
                    console.log("Error parsing XML", err.message);
                }
            });
        } catch (err) {
            console.log('Error while fetching junit XML', err.message);
        }

        return failures;
    }
}

module.exports = Pipeline;
