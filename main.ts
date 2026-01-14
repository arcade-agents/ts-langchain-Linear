"use strict";
import { getTools, confirm, arcade } from "./tools";
import { createAgent } from "langchain";
import {
  Command,
  MemorySaver,
  type Interrupt,
} from "@langchain/langgraph";
import chalk from "chalk";
import * as readline from "node:readline/promises";

// configure your own values to customize your agent

// The Arcade User ID identifies who is authorizing each service.
const arcadeUserID = process.env.ARCADE_USER_ID;
if (!arcadeUserID) {
  throw new Error("Missing ARCADE_USER_ID. Add it to your .env file.");
}
// This determines which MCP server is providing the tools, you can customize this to make a Slack agent, or Notion agent, etc.
// all tools from each of these MCP servers will be retrieved from arcade
const toolkits=['Linear'];
// This determines isolated tools that will be
const isolatedTools=[];
// This determines the maximum number of tool definitions Arcade will return
const toolLimit = 100;
// This prompt defines the behavior of the agent.
const systemPrompt = `# Introduction

Welcome to the Linear AI Agent! This agent is designed to facilitate project management tasks, issue tracking, and team collaboration using the Linear API. The agent can create, update, and manage initiatives, projects, and issues, as well as handle comments and notifications effectively. 

# Instructions

Your objective is to utilize the available tools in a sequence that efficiently accomplishes the desired task. Process the user's input to determine the needed action, identify any parameters required for the necessary tools, and execute them in the correct order. Maintain clarity in communication, providing updates on actions taken or required further input.

# Workflows

### 1. Create a New Issue
- **Tools**: 
  1. Linear_CreateIssue
- **Sequence**: 
  - Gather user inputs: team, title, description, assignee, labels, priority, state, project, cycle, estimate, due date, attachment URL, and attachment title.
  - Use the Linear_CreateIssue tool with the collected parameters to create the issue.

### 2. Update an Existing Issue
- **Tools**:
  1. Linear_GetIssue
  2. Linear_UpdateIssue
- **Sequence**:
  - Request the user to provide the issue ID and any fields they'd like to update (title, description, assignee, etc.).
  - Fetch the current details of the issue via Linear_GetIssue.
  - Call the Linear_UpdateIssue tool with the updated parameters.

### 3. Create a New Project
- **Tools**:
  1. Linear_CreateProject
- **Sequence**:
  - Gather user inputs: project name, team, description, content, state, lead, start date, target date.
  - Execute the Linear_CreateProject tool with the collected data.

### 4. Archive an Issue
- **Tools**:
  1. Linear_ArchiveIssue
- **Sequence**:
  - Request the user to provide the issue ID to archive.
  - Use the Linear_ArchiveIssue tool to process the archival action.

### 5. Add a Comment to an Issue
- **Tools**:
  1. Linear_AddComment
- **Sequence**:
  - Ask the user for the issue ID and the comment body.
  - Call the Linear_AddComment tool with the provided parameters.

### 6. Link a GitHub Artifact to an Issue
- **Tools**:
  1. Linear_LinkGithubToIssue
- **Sequence**:
  - Gather the issue ID and GitHub URL from the user.
  - If a custom title is provided, use it; otherwise, auto-generate from the URL.
  - Execute Linear_LinkGithubToIssue with the collected information.

### 7. Get User Notifications
- **Tools**:
  1. Linear_GetNotifications
- **Sequence**:
  - Optional: Request if the user wants unread notifications only.
  - Utilize the Linear_GetNotifications tool to retrieve notifications.

### 8. Transition Issue State
- **Tools**:
  1. Linear_TransitionIssueState
- **Sequence**:
  - Ask for the issue ID and the target state.
  - Call the Linear_TransitionIssueState tool to update the issue's state.

### 9. List Issues in a Project
- **Tools**:
  1. Linear_ListIssues
- **Sequence**:
  - Gather any optional filter criteria (keywords, team, state, etc.).
  - Execute the Linear_ListIssues tool to retrieve the relevant issues.

### 10. List Teams
- **Tools**:
  1. Linear_ListTeams
- **Sequence**:
  - Optionally gather filters (keywords, included archived status, creation date).
  - Execute the Linear_ListTeams tool to list the teams.

These workflows are designed to help you automate project management tasks effectively. Use the tools wisely and remember to communicate clearly with the user during each process.`;
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";

const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});



async function handleInterrupt(
  interrupt: Interrupt,
  rl: readline.Interface
): Promise<{ authorized: boolean }> {
  const value = interrupt.value;
  const authorization_required = value.authorization_required;
  const hitl_required = value.hitl_required;
  if (authorization_required) {
    const tool_name = value.tool_name;
    const authorization_response = value.authorization_response;
    console.log("⚙️: Authorization required for tool call", tool_name);
    console.log(
      "⚙️: Please authorize in your browser",
      authorization_response.url
    );
    console.log("⚙️: Waiting for you to complete authorization...");
    try {
      await arcade.auth.waitForCompletion(authorization_response.id);
      console.log("⚙️: Authorization granted. Resuming execution...");
      return { authorized: true };
    } catch (error) {
      console.error("⚙️: Error waiting for authorization to complete:", error);
      return { authorized: false };
    }
  } else if (hitl_required) {
    console.log("⚙️: Human in the loop required for tool call", value.tool_name);
    console.log("⚙️: Please approve the tool call", value.input);
    const approved = await confirm("Do you approve this tool call?", rl);
    return { authorized: approved };
  }
  return { authorized: false };
}

const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});

async function streamAgent(
  agent: any,
  input: any,
  config: any
): Promise<Interrupt[]> {
  const stream = await agent.stream(input, {
    ...config,
    streamMode: "updates",
  });
  const interrupts: Interrupt[] = [];

  for await (const chunk of stream) {
    if (chunk.__interrupt__) {
      interrupts.push(...(chunk.__interrupt__ as Interrupt[]));
      continue;
    }
    for (const update of Object.values(chunk)) {
      for (const msg of (update as any)?.messages ?? []) {
        console.log("🤖: ", msg.toFormattedString());
      }
    }
  }

  return interrupts;
}

async function main() {
  const config = { configurable: { thread_id: threadID } };
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log(chalk.green("Welcome to the chatbot! Type 'exit' to quit."));
  while (true) {
    const input = await rl.question("> ");
    if (input.toLowerCase() === "exit") {
      break;
    }
    rl.pause();

    try {
      let agentInput: any = {
        messages: [{ role: "user", content: input }],
      };

      // Loop until no more interrupts
      while (true) {
        const interrupts = await streamAgent(agent, agentInput, config);

        if (interrupts.length === 0) {
          break; // No more interrupts, we're done
        }

        // Handle all interrupts
        const decisions: any[] = [];
        for (const interrupt of interrupts) {
          decisions.push(await handleInterrupt(interrupt, rl));
        }

        // Resume with decisions, then loop to check for more interrupts
        // Pass single decision directly, or array for multiple interrupts
        agentInput = new Command({ resume: decisions.length === 1 ? decisions[0] : decisions });
      }
    } catch (error) {
      console.error(error);
    }

    rl.resume();
  }
  console.log(chalk.red("👋 Bye..."));
  process.exit(0);
}

// Run the main function
main().catch((err) => console.error(err));