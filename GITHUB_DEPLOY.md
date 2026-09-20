# GitHub 上传与发布

## 最快发布方式

1. 在 GitHub 新建一个空仓库，例如 `timegrid-ai`。
2. 将本文件夹内的全部内容上传到仓库根目录，不要只上传 `index.html`。
3. 打开仓库 `Settings → Pages`。
4. 在 `Build and deployment` 中将 `Source` 设为 `GitHub Actions`。
5. 打开 `Actions` 页面，等待 `Deploy TimeGrid AI to GitHub Pages` 运行完成。

发布地址通常为：

`https://你的GitHub用户名.github.io/仓库名/`

本包使用相对路径，既支持用户主页仓库，也支持普通项目仓库的二级路径。

## 自动更新需要开启的仓库权限

打开 `Settings → Actions → General → Workflow permissions`，选择：

- `Read and write permissions`
- 勾选允许 GitHub Actions 创建 Pull Request（如果仓库界面提供该选项）

自动任务默认不会直接覆盖主分支：发现并校验通过的新数据后，会创建或更新 `official-data-update` 分支和 Pull Request，审核后合并即可发布。

## 手动执行

- 发布网页：`Actions → Deploy TimeGrid AI to GitHub Pages → Run workflow`
- 更新国网数据：`Actions → Update official price data → Run workflow → grid`
- 更新旬及以上/带现货：`Actions → Update official price data → Run workflow → market`
- 校验发布包：在电脑安装 Node.js 后运行 `npm test`

自动更新的完整说明见 [AUTOMATIC_UPDATE.md](AUTOMATIC_UPDATE.md)。
