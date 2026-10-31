import MarkdownIt from "markdown-it";

// Tours are written by agents on anyone's branch: no raw HTML, ever.
const markdown = new MarkdownIt({ html: false, linkify: true });

export const renderMarkdown = (text: string) => markdown.render(text);
