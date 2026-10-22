import type { ToolCategory } from '@runwire/core';
import { piToolCategory } from '../pi/tool-category';

const EXTENSIONS: Record<string, ToolCategory> = {
  mem_get_observation: 'read',
  mem_context: 'read',
  mem_current_project: 'read',
  mem_timeline: 'read',
  project_report: 'read',
  module_report: 'read',
  codegraph: 'search',
  mem_search: 'search',
  bash_background: 'exec',
  codemode: 'exec',
  gentle_odd_phase: 'plan',
  subagent_continue: 'agent',
  subagent_send_message: 'agent',
  subagent_parent_message: 'agent',
  subagent_list_tasks: 'agent',
  subagent_result: 'agent',
  subagent_status: 'agent',
  orchestrator_session_id: 'agent',
  fetch_content: 'web',
  web_search: 'web',
  get_search_content: 'web',
  web_enable: 'web',
  mcp: 'mcp',
};

export function gentleToolCategory(name: string): ToolCategory {
  return EXTENSIONS[name] ?? piToolCategory(name);
}
