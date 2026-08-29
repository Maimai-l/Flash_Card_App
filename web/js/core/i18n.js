/* UI strings. Card and quiz content is never translated; only the chrome.

   No em dashes anywhere in here. They read as filler in an interface, and in
   Chinese they are simply the wrong punctuation. */

import { S } from './state.js';

const en = {
  app: 'Knowledge Cards',
  nav_home: 'Home', nav_quiz: 'Quiz', nav_cards: 'Cards',
  nav_import: 'Import', nav_stats: 'Stats', nav_settings: 'Settings',

  decks: 'Decks', all_decks: 'All decks', add_deck: 'New deck',
  deck_name_prompt: 'Deck name (use :: for sub-decks)',
  rename: 'Rename', delete: 'Delete', cancel: 'Cancel', save: 'Save', close: 'Close',
  confirm: 'Confirm', edit: 'Edit', done: 'Done', back: 'Back',

  due_today: 'Due today', new_cards: 'new', review_cards: 'review',
  study: 'Study', browse: 'Browse', cards: 'cards', card: 'card',
  to_study: 'To study today',
  heat_total: '{n} reviews, 6 months',
  nothing_due: 'Nothing due right now.',
  no_cards_yet: 'No cards yet. Import some to get started.',
  caught_up: 'Done for today.',
  study_more: 'Study more',
  study_more_note: 'Extra reviews do not change your limits.',

  show_answer: 'Show answer', hint: 'Hint',
  again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy',
  undo: 'Undo', blank: 'blank',
  is_correct: 'Correct', is_wrong: 'Not quite',
  session_done: 'Session finished',
  session_summary: '{cards} reviewed · {answers} answered',
  undo_nothing: 'Nothing to undo',
  undone: 'Review undone',
  exit_session: 'Exit',
  browse_empty: 'This deck has no cards.',
  prev: 'Previous', next: 'Next',

  quizzes: 'Quizzes', all_quizzes: 'All quizzes',
  questions: 'questions', question: 'question',
  never_taken: 'never taken', last_result: 'last {correct}/{total} · {when}',
  start: 'Start', retry_wrong: 'Retry wrong ({n})',
  resume: 'Resume', start_over: 'Start over',
  in_progress: '{done} of {total} answered',
  start_over_confirm: 'Discard the answers you have already given and begin again?',
  progress_saved: 'Progress saved',
  no_quizzes: 'No quizzes yet. Import one to get started.',
  check: 'Check', next_question: 'Next', finish: 'Finish',
  your_answer: 'Your answer', correct_answer: 'Correct answer',
  score_line: '{correct} of {total} correct',
  quiz_delete_confirm: 'Delete this quiz and its history?',
  type_answer: 'Type your answer',
  reorder_hint: 'Put these in the correct order',

  search: 'Search', front: 'Front', back: 'Back', deck: 'Deck',
  tags: 'Tags', hint_field: 'Hint', new_card: 'New card', edit_card: 'Edit card',
  no_cards_found: 'No cards match.',
  selected_n: '{n} selected', move_to: 'Move to…', suspend: 'Suspend',
  unsuspend: 'Unsuspend', delete_confirm: 'Delete {n} cards?',
  card_saved: 'Saved', card_deleted: 'Deleted',
  front_back_required: 'A card needs both a front and a back.',

  import_title: 'Import', paste_json: 'Paste JSON',
  copy_decks: 'Copy deck names', decks_copied: '{n} deck names copied',
  copy_decks_desc: 'Hand these to whatever writes the JSON so the "deck" field matches a deck you already have.',
  no_decks_to_copy: 'There are no decks yet.',
  target_deck: 'Target deck', from_json: 'From the JSON',
  validate: 'Validate', import_now: 'Import',
  import_new: 'new', import_updated: 'updated', import_duplicates: 'already there',
  allow_duplicates: 'Import duplicates too',
  import_done: 'Imported {new} new, {updated} updated',
  import_empty: 'Paste some JSON first.',
  will_create: 'create', will_replace: 'replace', will_keep: 'unchanged',
  export_title: 'Export', export_cards: 'Export cards', export_copied: 'Copied to clipboard',
  download: 'Download',

  stats_title: 'Stats', total_cards: 'Total cards', state_new: 'New',
  state_learning: 'Learning', state_review: 'Review',
  answers_30d: 'Answers (30 days)', retention_30d: 'Recall rate',
  hardest_cards: 'Most forgotten', lapses: 'lapses',
  rating_split: 'Ratings (30 days)', review_activity: 'Review activity',
  what_goes_here: 'What this expects',
  import_hint_body: 'One JSON object. Cards go in "cards", each with a front, a back and a deck. Nothing is written until you validate and confirm.',
  import_hint_quiz: 'A quiz goes in "quiz" alongside, or instead of, "cards".',
  load_more: 'Loading more…', all_loaded: 'That is all of them.',
  heat_less: 'Less', heat_more: 'More', no_reviews_yet: 'No reviews yet.',
  reviews_on: '{n} reviews · {date}', review_on: '1 review · {date}',
  no_reviews_on: 'No reviews · {date}',

  settings_title: 'Settings', language: 'Language',
  daily_limits: 'Daily limits',
  default_new_limit: 'New cards per day',
  default_review_limit: 'Reviews per day',
  limits_desc: 'Applies to every subject that has no limit of its own. Enter -1 for no limit.',
  per_deck_limits: 'Per-subject limits',
  per_deck_desc: 'Top-level decks only. Leave blank to use the defaults.',
  data: 'Data', reset_all: 'Delete everything',
  reset_desc: 'Removes every card, deck, quiz and review record. Settings are kept.',
  reset_confirm: 'Delete every card, deck and quiz? This cannot be undone.',
  reset_done: 'All data deleted',
  about: 'About', version: 'Version',

  copy_for_ai: 'Copy for AI', copied_for_ai: 'Copied. Paste it to your AI.',
  copy_struggles: 'Copy struggles',
  export_report: 'Export study report',
  ai_quiz_intro: 'From my flashcard app: quiz "{name}" ({subject}), I got {wrong} of {total} wrong. The questions, my answers and the correct ones:',
  ai_struggles_intro: 'From my flashcard app: {n} cards I just rated Again or Hard. Card ids are stable, so a rewritten card that keeps its id will update in place when I re-import it:',
  ai_report_intro: 'From my flashcard app: my current study state across all subjects.',

  shortcuts: 'Keyboard shortcuts',
  sc_rate: 'Rate the card', sc_pick: 'Pick an option', sc_flip: 'Turn the card',
  sc_anywhere: 'Anywhere', sc_review: 'Reviewing', sc_browsing: 'Browsing', sc_quiz: 'In a quiz',
  sc_check_advance: 'Check, then advance', sc_leave: 'Leave the session', sc_help: 'This overview',

  saved: 'Saved', error: 'Something went wrong',
};

const zh = {
  app: '知识卡片',
  nav_home: '主页', nav_quiz: '测验', nav_cards: '卡片',
  nav_import: '导入', nav_stats: '统计', nav_settings: '设置',

  decks: '卡组', all_decks: '全部卡组', add_deck: '新建卡组',
  deck_name_prompt: '卡组名称（用 :: 表示子卡组）',
  rename: '重命名', delete: '删除', cancel: '取消', save: '保存', close: '关闭',
  confirm: '确定', edit: '编辑', done: '完成', back: '返回',

  due_today: '今日待学', new_cards: '新卡', review_cards: '复习',
  study: '开始学习', browse: '浏览', cards: '张卡片', card: '张卡片',
  to_study: '今日待学',
  heat_total: '近半年 {n} 次复习',
  nothing_due: '当前没有到期的卡片。',
  no_cards_yet: '还没有卡片，先导入一些吧。',
  caught_up: '今天的份额已完成。',
  study_more: '继续学习',
  study_more_note: '额外复习不会改变你的每日上限。',

  show_answer: '显示答案', hint: '提示',
  again: '重来', hard: '困难', good: '良好', easy: '简单',
  undo: '撤销', blank: '未填',
  is_correct: '正确', is_wrong: '不对',
  session_done: '本轮结束',
  session_summary: '复习 {cards} 张 · 作答 {answers} 次',
  undo_nothing: '没有可撤销的记录',
  undone: '已撤销上一次评分',
  exit_session: '退出',
  browse_empty: '这个卡组还没有卡片。',
  prev: '上一张', next: '下一张',

  quizzes: '测验', all_quizzes: '全部测验',
  questions: '道题', question: '道题',
  never_taken: '未做过', last_result: '上次 {correct}/{total} · {when}',
  start: '开始', retry_wrong: '只做错题（{n}）',
  resume: '继续', start_over: '重新开始',
  in_progress: '已答 {done} / {total}',
  start_over_confirm: '放弃已经作答的部分，从头开始？',
  progress_saved: '进度已保存',
  no_quizzes: '还没有测验，先导入一份吧。',
  check: '检查', next_question: '下一题', finish: '完成',
  your_answer: '你的答案', correct_answer: '正确答案',
  score_line: '答对 {correct} / {total}',
  quiz_delete_confirm: '删除这份测验及其记录？',
  type_answer: '输入答案',
  reorder_hint: '把下面的条目排成正确顺序',

  search: '搜索', front: '正面', back: '背面', deck: '卡组',
  tags: '标签', hint_field: '提示', new_card: '新建卡片', edit_card: '编辑卡片',
  no_cards_found: '没有匹配的卡片。',
  selected_n: '已选 {n} 张', move_to: '移动到…', suspend: '暂停',
  unsuspend: '恢复', delete_confirm: '删除 {n} 张卡片？',
  card_saved: '已保存', card_deleted: '已删除',
  front_back_required: '正面和背面都不能为空。',

  import_title: '导入', paste_json: '粘贴 JSON',
  copy_decks: '复制卡组名', decks_copied: '已复制 {n} 个卡组名',
  copy_decks_desc: '把这些交给写 JSON 的一方，"deck" 字段就会落在已有的卡组上。',
  no_decks_to_copy: '还没有卡组。',
  target_deck: '目标卡组', from_json: '按 JSON 里写的',
  validate: '校验', import_now: '导入',
  import_new: '新增', import_updated: '更新', import_duplicates: '已存在',
  allow_duplicates: '重复的也导入',
  import_done: '已导入 {new} 张新卡，更新 {updated} 张',
  import_empty: '先粘贴 JSON。',
  will_create: '新建', will_replace: '替换', will_keep: '未改动',
  export_title: '导出', export_cards: '导出卡片', export_copied: '已复制到剪贴板',
  download: '下载',

  stats_title: '统计', total_cards: '卡片总数', state_new: '新卡',
  state_learning: '学习中', state_review: '复习中',
  answers_30d: '作答次数（30 天）', retention_30d: '回忆正确率',
  hardest_cards: '最常忘记', lapses: '次遗忘',
  rating_split: '评分分布（30 天）', review_activity: '复习记录',
  what_goes_here: '这里需要什么',
  import_hint_body: '一个 JSON 对象。卡片放在 "cards" 里，每张要有正面、背面和卡组。校验并确认之前不会写入任何东西。',
  import_hint_quiz: '测验放在 "quiz" 里，可以和 "cards" 并存，也可以单独出现。',
  load_more: '正在加载…', all_loaded: '已经到底了。',
  heat_less: '少', heat_more: '多', no_reviews_yet: '还没有复习记录。',
  reviews_on: '{n} 次复习 · {date}', review_on: '1 次复习 · {date}',
  no_reviews_on: '没有复习 · {date}',

  settings_title: '设置', language: '语言',
  daily_limits: '每日上限',
  default_new_limit: '每天新卡',
  default_review_limit: '每天复习',
  limits_desc: '适用于没有单独设置上限的学科，填 -1 表示不限。',
  per_deck_limits: '各学科上限',
  per_deck_desc: '仅顶层卡组。留空则使用默认值。',
  data: '数据', reset_all: '清空所有数据',
  reset_desc: '删除全部卡片、卡组、测验和复习记录，设置会保留。',
  reset_confirm: '删除全部卡片、卡组和测验？此操作无法撤销。',
  reset_done: '数据已清空',
  about: '关于', version: '版本',

  copy_for_ai: '复制给 AI', copied_for_ai: '已复制，去粘贴给你的 AI。',
  copy_struggles: '复制难点',
  export_report: '导出学习报告',
  ai_quiz_intro: '来自我的记忆卡片 app：测验 "{name}"（{subject}），{total} 题错了 {wrong} 题。题目、我的作答和正确答案如下：',
  ai_struggles_intro: '来自我的记忆卡片 app：刚才被我评为"重来 / 困难"的 {n} 张卡。卡片 id 是稳定的，重写时保留 id，重新导入就会原地更新：',
  ai_report_intro: '来自我的记忆卡片 app：各学科当前的学习状态。',

  shortcuts: '快捷键',
  sc_rate: '为卡片评分', sc_pick: '选择选项', sc_flip: '翻面',
  sc_anywhere: '任意界面', sc_review: '复习时', sc_browsing: '浏览时', sc_quiz: '做题时',
  sc_check_advance: '检查，再前进', sc_leave: '退出当前会话', sc_help: '本总览',

  saved: '已保存', error: '出错了',
};

const TABLES = { en, zh };

export function t(key, vars) {
  const table = TABLES[S.lang] || en;
  let text = table[key] !== undefined ? table[key] : (en[key] !== undefined ? en[key] : key);
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'zh', label: '中文' },
];
