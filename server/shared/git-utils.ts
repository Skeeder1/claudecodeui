import { spawn } from 'child_process';
import path from 'path';
import { promises as fs } from 'fs';
import type { Octokit } from '@octokit/rest';

export async function getGitRemoteUrl(repoPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', ['config', '--get', 'remote.origin.url'], {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => { stdout += data.toString(); });
    gitProcess.stderr.on('data', (data) => { stderr += data.toString(); });
    gitProcess.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Failed to get git remote: ${stderr}`));
    });
    gitProcess.on('error', (error) => {
      reject(new Error(`Failed to execute git: ${error.message}`));
    });
  });
}

export function normalizeGitHubUrl(url: string): string {
  let normalized = url.replace(/\.git$/, '');
  normalized = normalized.replace(/^git@github\.com:/, 'https://github.com/');
  normalized = normalized.replace(/\/$/, '');
  return normalized.toLowerCase();
}

export function parseGitHubUrl(url: string): { owner: string; repo: string } {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error('Invalid GitHub URL format');
  }
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, ''),
  };
}

export function autogenerateBranchName(message: string): string {
  let branchName = message
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  if (!branchName) branchName = 'task';

  const timestamp = Date.now().toString(36).slice(-6);
  const suffix = `-${timestamp}`;
  const maxBaseLength = 50 - suffix.length;

  if (branchName.length > maxBaseLength) {
    branchName = branchName.substring(0, maxBaseLength);
  }

  branchName = branchName.replace(/-$/, '').replace(/^-+/, '');

  if (!branchName || branchName.startsWith('-')) branchName = 'task';

  branchName = `${branchName}${suffix}`;

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branchName)) {
    return `branch-${timestamp}`;
  }

  return branchName;
}

export async function getCommitMessages(projectPath: string, limit = 5): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', ['log', `-${limit}`, '--pretty=format:%s'], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => { stdout += data.toString(); });
    gitProcess.stderr.on('data', (data) => { stderr += data.toString(); });
    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim().split('\n').filter((msg) => msg.length > 0));
      } else {
        reject(new Error(`Failed to get commit messages: ${stderr}`));
      }
    });
    gitProcess.on('error', (error) => {
      reject(new Error(`Failed to execute git: ${error.message}`));
    });
  });
}

export async function createGitHubBranch(
  octokit: InstanceType<typeof Octokit>,
  owner: string,
  repo: string,
  branchName: string,
  baseBranch = 'main',
): Promise<void> {
  try {
    const { data: ref } = await octokit.git.getRef({ owner, repo, ref: `heads/${baseBranch}` });
    await octokit.git.createRef({ owner, repo, ref: `refs/heads/${branchName}`, sha: ref.object.sha });
    console.log(`✅ Created branch '${branchName}' on GitHub`);
  } catch (error: any) {
    if (error.status === 422 && error.message.includes('Reference already exists')) {
      console.log(`ℹ️ Branch '${branchName}' already exists on GitHub`);
    } else {
      throw error;
    }
  }
}

export async function createGitHubPR(
  octokit: InstanceType<typeof Octokit>,
  owner: string,
  repo: string,
  branchName: string,
  title: string,
  body: string,
  baseBranch = 'main',
): Promise<{ number: number; url: string }> {
  const { data: pr } = await octokit.pulls.create({ owner, repo, title, head: branchName, base: baseBranch, body });
  console.log(`✅ Created pull request #${pr.number}: ${pr.html_url}`);
  return { number: pr.number, url: pr.html_url };
}

export async function cloneGitHubRepo(
  githubUrl: string,
  githubToken: string | null,
  projectPath: string,
): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      if (!githubUrl || !githubUrl.includes('github.com')) {
        throw new Error('Invalid GitHub URL');
      }

      const cloneDir = path.resolve(projectPath);

      try {
        await fs.access(cloneDir);
        try {
          const existingUrl = await getGitRemoteUrl(cloneDir);
          if (normalizeGitHubUrl(existingUrl) === normalizeGitHubUrl(githubUrl)) {
            console.log('✅ Repository already exists at path with correct URL');
            return resolve(cloneDir);
          }
          throw new Error(
            `Directory ${cloneDir} already exists with a different repository (${existingUrl}). Expected: ${githubUrl}`,
          );
        } catch {
          throw new Error(`Directory ${cloneDir} already exists but is not a valid git repository or git command failed`);
        }
      } catch (accessError: any) {
        if (accessError.code !== 'ENOENT') throw accessError;
      }

      await fs.mkdir(path.dirname(cloneDir), { recursive: true });

      const cloneUrl = githubToken
        ? githubUrl.replace('https://github.com', `https://${githubToken}@github.com`)
        : githubUrl;

      console.log('🔄 Cloning repository:', githubUrl);
      console.log('📁 Destination:', cloneDir);

      const gitProcess = spawn('git', ['clone', '--depth', '1', cloneUrl, cloneDir], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stderr = '';

      gitProcess.stderr.on('data', (data) => {
        stderr += data.toString();
        console.log('Git stderr:', data.toString());
      });
      gitProcess.on('close', (code) => {
        if (code === 0) {
          console.log('✅ Repository cloned successfully');
          resolve(cloneDir);
        } else {
          console.error('❌ Git clone failed:', stderr);
          reject(new Error(`Git clone failed: ${stderr}`));
        }
      });
      gitProcess.on('error', (error) => {
        reject(new Error(`Failed to execute git: ${error.message}`));
      });
    } catch (error) {
      reject(error);
    }
  });
}
