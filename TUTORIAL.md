---
title: "Build a Linear agent with LangChain (TypeScript) and Arcade"
slug: "ts-langchain-Linear"
framework: "langchain-ts"
language: "typescript"
toolkits: ["Linear"]
tools: []
difficulty: "beginner"
generated_at: "2026-03-12T01:35:15Z"
source_template: "ts_langchain"
agent_repo: ""
tags:
  - "langchain"
  - "typescript"
  - "linear"
---

# Build a Linear agent with LangChain (TypeScript) and Arcade

In this tutorial you'll build an AI agent using [LangChain](https://js.langchain.com/) with [LangGraph](https://langchain-ai.github.io/langgraphjs/) in TypeScript and [Arcade](https://arcade.dev) that can interact with Linear tools — with built-in authorization and human-in-the-loop support.

## Prerequisites

- The [Bun](https://bun.com) runtime
- An [Arcade](https://arcade.dev) account and API key
- An OpenAI API key

## Project Setup

First, create a directory for this project, and install all the required dependencies:

````bash
mkdir linear-agent && cd linear-agent
bun install @arcadeai/arcadejs @langchain/langgraph @langchain/core langchain chalk
````

## Start the agent script

Create a `main.ts` script, and import all the packages and libraries. Imports from 
the `"./tools"` package may give errors in your IDE now, but don't worry about those
for now, you will write that helper package later.

````typescript
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
````

## Configuration

In `main.ts`, configure your agent's toolkits, system prompt, and model. Notice
how the system prompt tells the agent how to navigate different scenarios and
how to combine tool usage in specific ways. This prompt engineering is important
to build effective agents. In fact, the more agentic your application, the more
relevant the system prompt to truly make the agent useful and effective at
using the tools at its disposal.

````typescript
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
const systemPrompt = "# Linear ReAct Agent \u2014 Prompt\n\n## Introduction\nYou are a ReAct-style AI agent that helps users manage work in Linear. You have access to a set of tools that can read, create, update, link, comment on, and archive Linear issues, projects, initiatives, cycles, and comments. Use those tools to carry out user requests reliably, safely, and with minimal friction.\n\n## Instructions\n- Use the ReAct reasoning pattern: alternate between short, crisp \"Thought:\" lines (what you plan / consider) and \"Action:\" lines (invoking a tool). After each tool invocation, include an \"Observation:\" with the tool result (the system will supply it). Finish with a \"Final Answer:\" that explains results to the user or asks for clarification.\n- Never produce hidden chain-of-thought. Keep \"Thought:\" lines short and functional (not introspective).\n- Always validate required fields before calling a tool. If any required input is missing, ask the user a clarifying question instead of calling the tool.\n- Prefer exact identifiers (IDs, slug_ids, issue keys like TOO-123) over names. If the user provides a name, and the tool supports fuzzy matching, ask whether you should auto-accept fuzzy matches or present suggestions.\n- For destructive or irreversible actions (archive, major content updates), always ask the user to confirm before proceeding.\n- For operations that can break state (e.g., updating a project\u0027s content will break inline comment anchoring), warn the user and ask them to confirm before proceeding.\n- If a tool returns suggestions or \"not found\" information, present those suggestions and ask the user which option to choose.\n- Keep user-facing messages concise and actionable: indicate what you did, what changed, and any next steps.\n- Use the tool that performs the requested operation directly (e.g., use Linear_CreateIssue to create issues rather than constructing a manual REST call).\n- When listing or fetching, include helpful defaults (e.g., include_comments=True when user asks for comments) but ask if they want different pagination or filters.\n\n## Output format (must follow)\nWhen acting, always follow this structure exactly:\n\nThought: [one-line reasoning or question]  \nAction: [ToolName]  \nParameters:\n```\n{ JSON-like parameters appropriate for the tool }\n```\nObservation: [results returned by the tool \u2014 populated by the system]  \n(Repeat Thought/Action/Observation steps as needed)  \nFinal Answer: [A clear, user-facing summary or follow-up question]\n\nExample:\nThought: Need to create an issue but missing team. Ask user for team.\nFinal Answer: I can create that issue \u2014 which team should it belong to?\n\nExample tool call:\nThought: Create an issue on the Product team.\nAction: Linear_CreateIssue\nParameters:\n```\n{\n  \"team\": \"PRODUCT\",\n  \"title\": \"Investigate onboarding performance\",\n  \"description\": \"Measure cold-start time and identify bottlenecks.\",\n  \"assignee\": \"@me\",\n  \"labels_to_add\": [\"performance\", \"onboarding\"]\n}\n```\nObservation: {tool output will appear here}  \nFinal Answer: I created TOO-456: Investigate onboarding performance and assigned it to you.\n\n## Workflows\nBelow are common workflows and the recommended sequence of tools and checks for each.\n\n1) Create an Issue (validated)\n- Purpose: Create a new, validated issue and attach metadata.\n- Sequence:\n  - Validate inputs (ask user if missing: team, title).\n  - Action: Linear_CreateIssue (provide team, title, description, assignee, labels_to_add, priority, state, project, cycle, parent_issue, estimate, due_date, attachment_url/title, auto_accept_matches if user permits fuzzy name resolution)\n  - If the tool suggests corrections (team not found, label suggestions), present options and ask user to confirm.\n  - Final Answer: Return created issue ID, summary, assignee and link.\n\n2) Update an Issue (partial update)\n- Purpose: Change title, description, assignee, labels, state, estimate, due date, attachments, or link to project/cycle.\n- Sequence:\n  - If user did not provide issue_id, ask for it.\n  - Action: Linear_GetIssue (include_relations, include_comments if needed) \u2014 to fetch current state for validation or to show before-change summary.\n  - Thought: Confirm which fields to update.\n  - Action: Linear_UpdateIssue\n  Parameters: include only fields the user wants changed.\n  - Final Answer: Summarize the fields updated and any important effects (e.g., state transitions, label changes).\n\n3) Transition an Issue to a new workflow state\n- Purpose: Move an issue through workflow stages.\n- Sequence:\n  - Action: Linear_GetIssue (to confirm team and current state if needed)\n  - Thought: Confirm target state and present choices if ambiguous.\n  - Action: Linear_TransitionIssueState\n  - Final Answer: Confirm the new state and note any next steps.\n\n4) Add a comment to an issue or reply to a comment\n- Purpose: Post new comments or threaded replies on issues.\n- Sequence:\n  - If replying: Action: Linear_ListComments to find parent_comment_id (or ask user for it).\n  - Action (new comment): Linear_AddComment\n  - Action (reply): Linear_ReplyToComment\n  - Final Answer: Return confirmation with comment id and a short preview.\n\n5) Subscribe/unsubscribe to issue notifications\n- Purpose: Control issue notifications.\n- Sequence:\n  - If user did not provide issue id: ask.\n  - Action: Linear_ManageIssueSubscription (subscribe True / False)\n  - Final Answer: Confirm subscription state.\n\n6) Link GitHub artifact to an issue\n- Purpose: Connect PR/commit/issue URL to a Linear issue.\n- Sequence:\n  - Validate issue id and github_url.\n  - Action: Linear_LinkGithubToIssue (provide title optionally)\n  - Final Answer: Confirm link created and show link preview.\n\n7) Create a Project (and optionally add content)\n- Purpose: Create a Linear project and set lead/start/target dates.\n- Sequence:\n  - Validate team.\n  - Action: Linear_CreateProject\n  - If the user later wants to add the project to an initiative:\n    - Action: Linear_AddProjectToInitiative (initiative and project by ID or name)\n  - Final Answer: Return project id/slug and link.\n\n8) Update a Project (non-destructive vs destructive)\n- Purpose: Update project metadata or document content.\n- Sequence:\n  - If changing \u0027content\u0027, warn: \"Updating \u0027content\u0027 will break inline comment anchoring. Confirm to proceed.\"\n  - Action: Linear_GetProject (to show current state)\n  - Action: Linear_UpdateProject (only provided fields)\n  - Final Answer: Return updated fields summary.\n\n9) Create a Project Status Update\n- Purpose: Post a status update to a project\u0027s Updates tab.\n- Sequence:\n  - Validate project_id.\n  - Action: Linear_CreateProjectUpdate (project_id, body, optional health)\n  - Final Answer: Confirm update posted.\n\n10) Create or link Initiatives\n- Purpose: Create initiatives or link projects to them.\n- Sequence (create):\n  - Action: Linear_CreateInitiative (name, description, status, target_date)\n  - Final Answer: Confirm initiative created.\n- Sequence (link project to initiative):\n  - Validate both inputs.\n  - Action: Linear_AddProjectToInitiative (initiative, project)\n  - Final Answer: Confirm link created.\n\n11) Archive or Restore (destructive actions)\n- Purpose: Archive issue/project/initiative.\n- Sequence:\n  - Confirm user intent explicitly.\n  - Action: Linear_ArchiveIssue OR Linear_ArchiveProject OR Linear_ArchiveInitiative\n  - Final Answer: Confirm archived and indicate how to restore if needed.\n\n12) Get details and list queries\n- Purpose: Fetch issue/project/initiative/team/cycle details or lists.\n- Sequence:\n  - Use the appropriate getter:\n    - Linear_GetIssue, Linear_GetProject, Linear_GetInitiative, Linear_GetTeam, Linear_GetCycle\n    - Listing: Linear_ListIssues, Linear_ListProjects, Linear_ListInitiatives, Linear_ListTeams, Linear_ListCycles\n  - Use filters as provided by the user (team, assignee, keywords, state, limit).\n  - If the description is truncated, use Linear_GetProjectDescription or Linear_GetInitiativeDescription with offsets.\n  - Final Answer: Provide a concise summary and ask if more detail or pagination is required.\n\n13) Create Relations between Issues\n- Purpose: Mark issues as blocked/duplicate/related.\n- Sequence:\n  - Validate both issue IDs.\n  - Action: Linear_CreateIssueRelation (issue, related_issue, relation_type)\n  - Final Answer: Confirm relation and explain its directionality.\n\n14) Comments \u0026 Project comment threads\n- Purpose: List or add project document comments.\n- Sequence:\n  - List: Linear_ListProjectComments\n  - Add: Linear_AddProjectComment (project, body, quoted_text optional, auto_accept_matches optional)\n  - Reply: Linear_ReplyToProjectComment\n  - Final Answer: Show comment id and a short preview.\n\n15) Workspace helper: Who am I and recent activity\n- Purpose: Find the authenticated user\u0027s info or recent activity.\n- Sequence:\n  - Action: Linear_WhoAmI or Linear_GetRecentActivity\n  - Final Answer: Provide the requested personal info or activity list.\n\n## Error handling and ambiguity resolution\n- If a tool returns a validation error (entity not found), present the suggestions returned by the tool and ask the user which to pick.\n- If fuzzy name matching is possible and you are unsure, ask:\n  - \"I can try fuzzy-matching the name you provided. Should I auto-accept matches above 90% confidence, or would you like me to show suggestions?\"\n- If a user asks to perform multiple independent operations, break them into separate tool calls and confirm each step when it has side effects.\n- If a tool call fails for transient reasons (rate limits, network), apologize briefly and retry once after a short wait, then surface errors to the user if the retry fails.\n\n## Minimal examples (use these as templates)\nCreate issue:\n```\nThought: Need to create an issue in the PRODUCT team.\nAction: Linear_CreateIssue\nParameters:\n{\n  \"team\": \"PRODUCT\",\n  \"title\": \"Add SSO support\",\n  \"description\": \"Support SAML and OIDC providers for SSO.\",\n  \"assignee\": \"@me\",\n  \"labels_to_add\": [\"auth\", \"security\"]\n}\n```\n\nArchive issue (confirm first):\n```\nThought: User asked to archive TOO-123 \u2014 confirm intent first.\nFinal Answer: Are you sure you want to archive TOO-123? This will hide it from default views but it can be restored. Reply \u0027yes\u0027 to proceed.\n```\n\nTransition issue:\n```\nThought: Move TOO-456 to \u0027Done\u0027 after confirming target state exists.\nAction: Linear_TransitionIssueState\nParameters:\n{\n  \"issue_id\": \"TOO-456\",\n  \"target_state\": \"Done\"\n}\n```\n\nLink GitHub PR:\n```\nThought: Link given PR URL to TOO-789.\nAction: Linear_LinkGithubToIssue\nParameters:\n{\n  \"issue\": \"TOO-789\",\n  \"github_url\": \"https://github.com/org/repo/pull/42\"\n}\n```\n\n---\n\nFollow this prompt structure to operate the ReAct agent. Be succinct, explicit in required parameters, and careful with destructive actions. Ask clarifying questions when any required information is missing or ambiguous.";
// This determines which LLM will be used inside the agent
const agentModel = process.env.OPENAI_MODEL;
if (!agentModel) {
  throw new Error("Missing OPENAI_MODEL. Add it to your .env file.");
}
// This allows LangChain to retain the context of the session
const threadID = "1";
````

Set the following environment variables in a `.env` file:

````bash
ARCADE_API_KEY=your-arcade-api-key
ARCADE_USER_ID=your-arcade-user-id
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-5-mini
````

## Implementing the `tools.ts` module

The `tools.ts` module fetches Arcade tool definitions and converts them to LangChain-compatible tools using Arcade's Zod schema conversion:

### Create the file and import the dependencies

Create a `tools.ts` file, and add import the following. These will allow you to build the helper functions needed to convert Arcade tool definitions into a format that LangChain can execute. Here, you also define which tools will require human-in-the-loop confirmation. This is very useful for tools that may have dangerous or undesired side-effects if the LLM hallucinates the values in the parameters. You will implement the helper functions to require human approval in this module.

````typescript
import { Arcade } from "@arcadeai/arcadejs";
import {
  type ToolExecuteFunctionFactoryInput,
  type ZodTool,
  executeZodTool,
  isAuthorizationRequiredError,
  toZod,
} from "@arcadeai/arcadejs/lib/index";
import { type ToolExecuteFunction } from "@arcadeai/arcadejs/lib/zod/types";
import { tool } from "langchain";
import {
  interrupt,
} from "@langchain/langgraph";
import readline from "node:readline/promises";

// This determines which tools require human in the loop approval to run
const TOOLS_WITH_APPROVAL = ['Linear_AddComment', 'Linear_AddProjectComment', 'Linear_AddProjectToInitiative', 'Linear_ArchiveInitiative', 'Linear_ArchiveIssue', 'Linear_ArchiveProject', 'Linear_CreateInitiative', 'Linear_CreateIssue', 'Linear_CreateIssueRelation', 'Linear_CreateProject', 'Linear_CreateProjectUpdate', 'Linear_LinkGithubToIssue', 'Linear_ManageIssueSubscription', 'Linear_ReplyToComment', 'Linear_ReplyToProjectComment', 'Linear_TransitionIssueState', 'Linear_UpdateComment', 'Linear_UpdateInitiative', 'Linear_UpdateIssue', 'Linear_UpdateProject'];
````

### Create a confirmation helper for human in the loop

The first helper that you will write is the `confirm` function, which asks a yes or no question to the user, and returns `true` if theuser replied with `"yes"` and `false` otherwise.

````typescript
// Prompt user for yes/no confirmation
export async function confirm(question: string, rl?: readline.Interface): Promise<boolean> {
  let shouldClose = false;
  let interface_ = rl;

  if (!interface_) {
      interface_ = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
      });
      shouldClose = true;
  }

  const answer = await interface_.question(`${question} (y/n): `);

  if (shouldClose) {
      interface_.close();
  }

  return ["y", "yes"].includes(answer.trim().toLowerCase());
}
````

Tools that require authorization trigger a LangGraph interrupt, which pauses execution until the user completes authorization in their browser.

### Create the execution helper

This is a wrapper around the `executeZodTool` function. Before you execute the tool, however, there are two logical checks to be made:

1. First, if the tool the agent wants to invoke is included in the `TOOLS_WITH_APPROVAL` variable, human-in-the-loop is enforced by calling `interrupt` and passing the necessary data to call the `confirm` helper. LangChain will surface that `interrupt` to the agentic loop, and you will be required to "resolve" the interrupt later on. For now, you can assume that the reponse of the `interrupt` will have enough information to decide whether to execute the tool or not, depending on the human's reponse.
2. Second, if the tool was approved by the human, but it doesn't have the authorization of the integration to run, then you need to present an URL to the user so they can authorize the OAuth flow for this operation. For this, an execution is attempted, that may fail to run if the user is not authorized. When it fails, you interrupt the flow and send the authorization request for the harness to handle. If the user authorizes the tool, the harness will reply with an `{authorized: true}` object, and the system will retry the tool call without interrupting the flow.

````typescript
export function executeOrInterruptTool({
  zodToolSchema,
  toolDefinition,
  client,
  userId,
}: ToolExecuteFunctionFactoryInput): ToolExecuteFunction<any> {
  const { name: toolName } = zodToolSchema;

  return async (input: unknown) => {
    try {

      // If the tool is on the list that enforces human in the loop, we interrupt the flow and ask the user to authorize the tool

      if (TOOLS_WITH_APPROVAL.includes(toolName)) {
        const hitl_response = interrupt({
          authorization_required: false,
          hitl_required: true,
          tool_name: toolName,
          input: input,
        });

        if (!hitl_response.authorized) {
          // If the user didn't approve the tool call, we throw an error, which will be handled by LangChain
          throw new Error(
            `Human in the loop required for tool call ${toolName}, but user didn't approve.`
          );
        }
      }

      // Try to execute the tool
      const result = await executeZodTool({
        zodToolSchema,
        toolDefinition,
        client,
        userId,
      })(input);
      return result;
    } catch (error) {
      // If the tool requires authorization, we interrupt the flow and ask the user to authorize the tool
      if (error instanceof Error && isAuthorizationRequiredError(error)) {
        const response = await client.tools.authorize({
          tool_name: toolName,
          user_id: userId,
        });

        // We interrupt the flow here, and pass everything the handler needs to get the user's authorization
        const interrupt_response = interrupt({
          authorization_required: true,
          authorization_response: response,
          tool_name: toolName,
          url: response.url ?? "",
        });

        // If the user authorized the tool, we retry the tool call without interrupting the flow
        if (interrupt_response.authorized) {
          const result = await executeZodTool({
            zodToolSchema,
            toolDefinition,
            client,
            userId,
          })(input);
          return result;
        } else {
          // If the user didn't authorize the tool, we throw an error, which will be handled by LangChain
          throw new Error(
            `Authorization required for tool call ${toolName}, but user didn't authorize.`
          );
        }
      }
      throw error;
    }
  };
}
````

### Create the tool retrieval helper

The last helper function of this module is the `getTools` helper. This function will take the configurations you defined in the `main.ts` file, and retrieve all of the configured tool definitions from Arcade. Those definitions will then be converted to LangGraph `Function` tools, and will be returned in a format that LangChain can present to the LLM so it can use the tools and pass the arguments correctly. You will pass the `executeOrInterruptTool` helper you wrote in the previous section so all the bindings to the human-in-the-loop and auth handling are programmed when LancChain invokes a tool.


````typescript
// Initialize the Arcade client
export const arcade = new Arcade();

export type GetToolsProps = {
  arcade: Arcade;
  toolkits?: string[];
  tools?: string[];
  userId: string;
  limit?: number;
}


export async function getTools({
  arcade,
  toolkits = [],
  tools = [],
  userId,
  limit = 100,
}: GetToolsProps) {

  if (toolkits.length === 0 && tools.length === 0) {
      throw new Error("At least one tool or toolkit must be provided");
  }

  // Todo(Mateo): Add pagination support
  const from_toolkits = await Promise.all(toolkits.map(async (tkitName) => {
      const definitions = await arcade.tools.list({
          toolkit: tkitName,
          limit: limit
      });
      return definitions.items;
  }));

  const from_tools = await Promise.all(tools.map(async (toolName) => {
      return await arcade.tools.get(toolName);
  }));

  const all_tools = [...from_toolkits.flat(), ...from_tools];
  const unique_tools = Array.from(
      new Map(all_tools.map(tool => [tool.qualified_name, tool])).values()
  );

  const arcadeTools = toZod({
    tools: unique_tools,
    client: arcade,
    executeFactory: executeOrInterruptTool,
    userId: userId,
  });

  // Convert Arcade tools to LangGraph tools
  const langchainTools = arcadeTools.map(({ name, description, execute, parameters }) =>
    (tool as Function)(execute, {
      name,
      description,
      schema: parameters,
    })
  );

  return langchainTools;
}
````

## Building the Agent

Back on the `main.ts` file, you can now call the helper functions you wrote to build the agent.

### Retrieve the configured tools

Use the `getTools` helper you wrote to retrieve the tools from Arcade in LangChain format:

````typescript
const tools = await getTools({
  arcade,
  toolkits: toolkits,
  tools: isolatedTools,
  userId: arcadeUserID,
  limit: toolLimit,
});
````

### Write an interrupt handler

When LangChain is interrupted, it will emit an event in the stream that you will need to handle and resolve based on the user's behavior. For a human-in-the-loop interrupt, you will call the `confirm` helper you wrote earlier, and indicate to the harness whether the human approved the specific tool call or not. For an auth interrupt, you will present the OAuth URL to the user, and wait for them to finishe the OAuth dance before resolving the interrupt with `{authorized: true}` or `{authorized: false}` if an error occurred:

````typescript
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
````

### Create an Agent instance

Here you create the agent using the `createAgent` function. You pass the system prompt, the model, the tools, and the checkpointer. When the agent runs, it will automatically use the helper function you wrote earlier to handle tool calls and authorization requests.

````typescript
const agent = createAgent({
  systemPrompt: systemPrompt,
  model: agentModel,
  tools: tools,
  checkpointer: new MemorySaver(),
});
````

### Write the invoke helper

This last helper function handles the streaming of the agent’s response, and captures the interrupts. When the system detects an interrupt, it adds the interrupt to the `interrupts` array, and the flow interrupts. If there are no interrupts, it will just stream the agent’s to your console.

````typescript
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
````

### Write the main function

Finally, write the main function that will call the agent and handle the user input.

Here the `config` object configures the `thread_id`, which tells the agent to store the state of the conversation into that specific thread. Like any typical agent loop, you:

1. Capture the user input
2. Stream the agent's response
3. Handle any authorization interrupts
4. Resume the agent after authorization
5. Handle any errors
6. Exit the loop if the user wants to quit

````typescript
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
````

## Running the Agent

### Run the agent

```bash
bun run main.ts
```

You should see the agent responding to your prompts like any model, as well as handling any tool calls and authorization requests.

## Next Steps

- Clone the [repository](https://github.com/arcade-agents/ts-langchain-Linear) and run it
- Add more toolkits to the `toolkits` array to expand capabilities
- Customize the `systemPrompt` to specialize the agent's behavior
- Explore the [Arcade documentation](https://docs.arcade.dev) for available toolkits

