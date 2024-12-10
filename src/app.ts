import express from "express";
import { Octokit } from "@octokit/rest";

const app = express();
const port = 3001;

// Init Octokit
const octokit = new Octokit({
  auth: process.env.GITHUB_PERSONAL_ACCESS_TOKEN,
});

// Middleware for parsing JSON bodies
app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).json({ message: "Hello World" });
});

async function listReviewsByPullNumber(pullNumber: number) {
  try {
    const { data } = await octokit.rest.pulls.listReviews({
      owner: process.env.GITHUB_REPO_OWNER ?? "",
      repo: process.env.GITHUB_REPO_NAME ?? "",
      pull_number: pullNumber,
    });
    return data;
  } catch (error) {
    console.error(`Error listing reviews for PR #${pullNumber}:`, error);
    throw new Error("Failed to fetch reviews.");
  }
}

async function listReviewComments(pullNumber: number, reviewId: number) {
  try {
    const { data } = await octokit.rest.pulls.listReviewComments({
      owner: process.env.GITHUB_REPO_OWNER ?? "",
      repo: process.env.GITHUB_REPO_NAME ?? "",
      pull_number: pullNumber,
      review_id: reviewId,
    });
    return data;
  } catch (error) {
    console.error(`Error listing review comments for PR #${pullNumber}, Review #${reviewId}:`, error);
    throw new Error("Failed to fetch review comments.");
  }
}

async function searchPRsByDate(usernames: string[], startDate: string) {
  try {
    const prs: any[] = [];
    let totalComments = 0;

    for (const username of usernames) {
      let page = 1;
      let userPrs: any[] = [];

      do {
        const query = `repo:${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME} is:pr created:>=${startDate} author:${username}`;
        const response = await octokit.rest.search.issuesAndPullRequests({
          q: query,
          per_page: 100,
          page,
          sort: "created",
          order: "asc",
        });
        userPrs = response.data.items;
        prs.push(...userPrs);
        page++;
      } while (userPrs.length > 0);
    }

    const teamPrs = await Promise.all(
      prs.map(async (pr) => {
        const reviews = await listReviewsByPullNumber(pr.number);
        const reviewComments = reviews.length
          ? await listReviewComments(pr.number, reviews[0].id)
          : [];

        const comments = reviewComments.map((comment: any) => ({
          user: comment.user.login,
          body: comment.body,
          created_at: comment.created_at,
          updated_at: comment.updated_at,
        }));

        totalComments += reviewComments.length;

        return {
          title: pr.title,
          number: pr.number,
          created_by: pr.user.login,
          url: pr.html_url,
          state: pr.state,
          created_at: pr.created_at,
          updated_at: pr.updated_at,
          closed_at: pr.closed_at,
          reviewComments: comments,
        };
      })
    );

    return { totalPRs: prs.length, totalComments, teamPrs };
  } catch (error) {
    console.error("Error searching PRs:", error);
    throw new Error("Failed to fetch PRs.");
  }
}

app.post("/github-stats", async (req:any, res:any) => {
  try {
    const { usernames, startDate } = req.body;

    if (!usernames || !startDate) {
      return res.status(400).json({ error: "Usernames and startDate are required." });
    }

    const prs = await searchPRsByDate(usernames, startDate);
    res.status(200).json(prs);
  } catch (error) {
    console.error("Error handling /github-stats request:", error);
    res.status(500).json({ error: "Failed to fetch GitHub stats." });
  }
});

app.listen(port, () => {
  console.log(`App listening on http://localhost:${port}`);
});
