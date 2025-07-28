// This module will handle all Git-related operations.

class GitManager {
  constructor(fs) {
    this.fs = fs;
    this.git = window.git;
    this.http = window.isomorphicGitHttp;
    this.dir = '/';
  }

  async init() {
    await this.git.init({ fs: this.fs, dir: this.dir });
  }

  async status(filepath) {
    return await this.git.status({ fs: this.fs, dir: this.dir, filepath });
  }

  async statusMatrix() {
    return await this.git.statusMatrix({ fs: this.fs, dir: this.dir });
  }

  async add(filepath) {
    await this.git.add({ fs: this.fs, dir: this.dir, filepath });
  }

  async log() {
    return await this.git.log({ fs: this.fs, dir: this.dir });
  }

  async commit(message, author) {
    const sha = await this.git.commit({
      fs: this.fs,
      dir: this.dir,
      message,
      author,
    });
    return sha;
  }
}

// Export an instance of the GitManager
// This will be initialized later with the file system.
export default new GitManager(null);