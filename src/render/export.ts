/** Render + write, the operation behind `export_mindmap` and `mindlm-mcp export`. */

import { type RenderOptions, renderMindmapHtml } from './html.js';
import { resolveOutputPath, type WriteResult, writeOutputFile } from './output.js';

export interface ExportOptions extends RenderOptions {
  /** File, or a directory to generate a name in. Defaults to MINDMAP_OUTPUT_DIR. */
  outputPath?: string;
  overwrite?: boolean;
}

export interface ExportResult extends WriteResult {
  title: string;
  nodes: number;
  offline: boolean;
  /** The written document, for callers that want to return it inline. */
  html: string;
}

export async function exportMindmap(options: ExportOptions): Promise<ExportResult> {
  const rendered = await renderMindmapHtml(options);
  const path = await resolveOutputPath(options.outputPath, rendered.title, '.html');
  const written = await writeOutputFile(path, rendered.html, {
    overwrite: options.overwrite ?? false,
  });

  return {
    ...written,
    title: rendered.title,
    nodes: rendered.nodes,
    offline: rendered.offline,
    html: rendered.html,
  };
}
