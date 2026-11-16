// ---------------------------------------------------------------------------
// devConsole.js — the developer console: press ~ (the key under Esc) to open it,
// type a command, press Enter. It is a tool for testing the game, not part of it.
//
// This file is only the window: the text box, the list of answers, the history
// (arrow up / down) and name completion (Tab). It knows no commands of its own
// except "help". The commands are added from outside:
//
//   devConsole.add('money', '<amount>', 'give (or take) money', (args) => 'text to show');
//
// args = the words typed after the command name. Whatever the function returns is
// printed; if it throws, the error is printed in red. The game's own commands are
// in game/devCommands.js.
// ---------------------------------------------------------------------------
import { KEYS } from '../config.js';

export function createDevConsole() {
  const commands = {};                    // name -> { usage, about, run }
  const history = [];                     // what was typed before, oldest first
  let historyAt = 0;

  // ---- The window (built here, so index.html does not carry a developer tool) ----
  const root = document.createElement('div');
  root.id = 'dev-console';
  root.className = 'hidden';
  root.innerHTML = '<div id="dev-console-log"></div><div id="dev-console-line"><span>&gt;</span><input id="dev-console-input" spellcheck="false" autocomplete="off"></div>';
  document.body.append(root);
  const log = root.querySelector('#dev-console-log'), box = root.querySelector('input');

  function print(text, kind = '') {
    const line = document.createElement('div');
    line.className = kind;
    line.textContent = text;
    log.append(line);
    while (log.children.length > 200) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  function run(typed) {
    const [name, ...args] = typed.trim().split(/\s+/);
    if (!name) return;
    print('> ' + typed, 'typed');
    const command = commands[name.toLowerCase()];
    if (!command) return print(`No command "${name}". Type help for the list.`, 'bad');
    try {
      const answer = command.run(args);
      if (answer) print(String(answer));
    } catch (error) {
      print(error.message || String(error), 'bad');
    }
  }

  function toggle(open = root.classList.contains('hidden')) {
    root.classList.toggle('hidden', !open);
    if (open) box.focus(); else box.blur();
  }

  // ~ opens and closes it from anywhere (and is never typed into the box). The key is known by its
  // place on the keyboard (KEYS.console) or, on a keyboard laid out differently, by the character it types.
  window.addEventListener('keydown', (e) => {
    if (KEYS.console.includes(e.code) || e.key === '`' || e.key === '~') { e.preventDefault(); toggle(); }
  });
  box.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      if (box.value.trim()) history.push(box.value);
      historyAt = history.length;
      run(box.value);
      box.value = '';
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      historyAt = Math.max(0, Math.min(history.length, historyAt + (e.key === 'ArrowUp' ? -1 : 1)));
      box.value = history[historyAt] || '';
    } else if (e.key === 'Tab') {
      // Finish the command name being typed, if only one command starts that way.
      e.preventDefault();
      const matches = Object.keys(commands).filter((name) => name.startsWith(box.value.toLowerCase()));
      if (matches.length === 1) box.value = matches[0] + ' ';
      else if (matches.length > 1) print(matches.join('   '));
    } else if (e.key === 'Escape') toggle(false);
  });

  const devConsole = {
    get open() { return !root.classList.contains('hidden'); },
    toggle, print, run,
    /** Add a command. usage = what to type after its name ('' if nothing), about = one line saying what it does. */
    add(name, usage, about, run) { commands[name] = { usage, about, run }; },
  };
  devConsole.add('help', '', 'list every command', () =>
    Object.entries(commands).map(([name, c]) => `${(name + ' ' + c.usage).padEnd(26)} ${c.about}`).join('\n'));
  print('Developer console. Type help for the list of commands, ~ or Esc to close.');
  return devConsole;
}
