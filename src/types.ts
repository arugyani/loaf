export type SliceFrontmatter = {
  id: string;
  title: string;
  cited_files: string[];
  last_accessed?: string;
  last_baked_commit: string;
  created_by: "model" | "human";
  tags?: string[];
};

export type Slice = {
  frontmatter: SliceFrontmatter;
  body: string;
  path: string;
};

export type SliceSummary = {
  id: string;
  title: string;
  tags: string[];
  cited_files: string[];
  last_baked_commit: string;
  path: string;
};

export type CrumbFrontmatter = {
  target: string;
  severity: "info" | "warning" | "critical";
  last_baked_commit: string;
};

export type Crumb = {
  frontmatter: CrumbFrontmatter;
  body: string;
  path: string;
};

export type StalenessResult = {
  stale: boolean;
  changed_files: string[];
  commits: GitCommit[];
  reason?: "file-changed" | "commit-missing" | "not-ancestor";
};

export type GitCommit = {
  sha: string;
  subject: string;
  file: string;
};

export type LoafIndex = {
  version: 1;
  generated_at: string;
  slices: SliceSummary[];
  crumbs: {
    target: string;
    path: string;
    severity: CrumbFrontmatter["severity"];
    last_baked_commit: string;
  }[];
};

export type LoafConfig = {
  version: string;
  crumb_cap_per_file?: number;
};
