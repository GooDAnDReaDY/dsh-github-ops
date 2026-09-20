# 📦 @goodandready/dsh-github-ops

<div align="center">

<h3>Комплексные операции GitHub, релизы, CI-запуски, секреты и санитизированные зеркала для DeepSeek Harness</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@goodandready/dsh-github-ops"><img src="https://img.shields.io/npm/v/@goodandready/dsh-github-ops.svg?style=for-the-badge&color=6366f1&labelColor=1e1b4b" alt="npm version"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/GooDAnDReaDY/dsh-github-ops.svg?style=for-the-badge&color=10b981&labelColor=064e3b" alt="license"></a>
  <a href="https://github.com/topics/dsh-plugin"><img src="https://img.shields.io/badge/DSH-Plugin-8b5cf6.svg?style=for-the-badge&labelColor=2e1065" alt="DSH Plugin"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node-20%2B-f59e0b.svg?style=for-the-badge&labelColor=451a03" alt="Node version"></a>
</p>

<p align="center">
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/Все_проекты_автора-goodandready.app-ff4500.svg?style=for-the-badge&logo=rocket&logoColor=white&labelColor=1a1a2e" alt="Все проекты автора"></a>
</p>

<p align="center">
  <a href="README.md"><b>🇬🇧 English</b></a> •
  <a href="README.zh.md"><b>🇨🇳 中文说明</b></a> •
  <a href="README.ru.md"><b>🇷🇺 Русский</b></a>
</p>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>Если вам нравится этот плагин, поставьте ему Star на GitHub</strong> — это покажет мне, что плагин полезен, и добавит мотивации продолжать его развитие.
      <br><br>
      🐛 <strong>Если вы нашли ошибку или хотите предложить новую функцию</strong>, откройте issue на GitHub на любом удобном языке — я регулярно просматриваю предложения и реализую полезные идеи в будущих версиях плагина.
    </td>
  </tr>
</table>

</div>

---

Операции с GitHub для [DeepSeek Harness](https://github.com/topics/dsh-plugin): релизы,
теги, защищённый универсальный доступ к API, запуски workflow, секреты и публикация
санитизированного зеркала.

Плагин появился потому, что релизному конвейеру нужны операции, которых нет в
существующем GitHub-плагине: сначала релизы и теги, затем способ публиковать
GitHub-зеркало, которое несёт **продукт**, а не всё дерево разработки.

> **Статус: в работе, релиза нет.** Публикация состоится только после того, как в плагине
> появятся все инструменты (см. [План](#план)).

## Установка

```bash
dsh plugin --profile web add @goodandready/dsh-github-ops
```

Нужен токен GitHub в сервисе учётных данных DSH. Имя по умолчанию — `GITHUB_TOKEN`,
в настройках плагина хранится только это **имя**.

## Настройки

| Настройка | Значение по умолчанию | Смысл |
|---|---|---|
| `tokenEnv` | `GITHUB_TOKEN` | Имя, которое ищется в креденшелах DSH, затем в переменной окружения, затем в `gh` CLI. Само значение в настройках не хранится. |
| `tokenSource` | `auto` | Откуда берётся доступ: `auto` — креденшел DSH, затем переменная окружения, затем сессия `gh`; можно зафиксировать `credentials`, `env` или `gh`. |
| `defaultRepository` | пусто | `owner/repo`, если в вызове инструмента репозиторий не указан. |
| `baseUrl` | `https://api.github.com` | База API; меняется для GitHub Enterprise. |
| `timeoutMs` | `30000` | Таймаут одного запроса. |
| `maxRetries` | `2` | Повторы для неудачного чтения (запись не повторяется). |
| `reviewRulesJson` | пусто | Переопределение правил ревью в JSON: `sensitivePaths`, `sensitiveSeverity`, `attentionPaths`, `migrationPaths`, `testsRequired`, `sourcePatterns`, `testPatterns`, `largeDiffLines`. |
| `allowedActions` | все | Разрешённые записи; всё остальное отклоняется, и каждая всё равно спрашивает подтверждение. |
| `autoApprove` | пусто | Действия, которые неавтономный прогон (`DSH_GITHUB_OPS_UNATTENDED=1`) может выполнить без вопроса; разрушительные не автоутверждаются никогда. |
| `reviewJobTimeoutMs` | `120000` | Сколько может работать фоновая задача ревью. |

## Инструменты

### Релизы

| Инструмент | Что делает |
|---|---|
| `gh_release_list` | Список релизов от новых к старым (только чтение). |
| `gh_release_view` | Чтение релиза по тегу: флаги, заметки, артефакты (только чтение). |
| `gh_release_create` | Создание релиза для тега, при необходимости на конкретном коммите. |
| `gh_release_edit` | Правка заголовка, заметок, draft/prerelease и **того, какой релиз считается latest**. |
| `gh_release_delete` | Удаление релиза (нужно `confirm: true`). |

`gh_release_edit` с `makeLatest: true` — тот шаг, который держит бейдж репозитория на
актуальной версии: если после этого создать релиз старой версии, «Latest» уедет назад.

### Теги

| Инструмент | Что делает |
|---|---|
| `gh_tag_list` | Список тегов с SHA коммитов (только чтение). |
| `gh_tag_create` | Создание тега — обычного, либо аннотированного при наличии `message`. |
| `gh_tag_delete` | Удаление тега (нужно `confirm: true`). |

### Универсальный API

`gh_api` закрывает всё, что не покрыто типизированными инструментами (refs, rulesets,
организации, gists). Чтение свободно; `POST`/`PATCH`/`PUT`/`DELETE` требуют
`confirm: true`. Удаление репозитория, его перенос и удаление организации отклоняются
сразу: одно подтверждение не делает такие вызовы безопасными.

### Issues и pull requests

| Инструмент | Что делает |
|---|---|
| `gh_issue` | Список или чтение issues (`action: list/get/comments`); PR приходят с `kind: "pr"`. |
| `issue_open`, `issue_comment`, `issue_close` | Создать issue, прокомментировать, закрыть (с причиной). |
| `gh_search` | Поиск issues и PR синтаксисом GitHub (отдельная квота). |
| `pr_create`, `pr_update` | Открыть PR из head-ветки; правка заголовка, тела, состояния, базовой ветки. |
| `pr_merge` | Слияние PR (merge/squash/rebase) с опциональным удалением head-ветки. |
| `gh_review` | Один обзорный пакет: метаданные, области, дифф с лимитом, комменты, сводка CI и детерминированные находки (секреты, миграции, CI-конфиг, изменения в исходниках без тестов, крупный дифф). |
| `review_post` | Публикация обзора: сводный комментарий или построчные inline-замечания. |
| `gh_checks` | Check-runs, статусы коммита и единый вердикт. |
| `ci_run` | Одноразовый обзор PR с вердиктом по правилам. |

### Публикация зеркала

| Инструмент | Что делает |
|---|---|
| `gh_mirror_check` | Read-only план: какие продуктовые файлы уедут в зеркало, сколько останется и почему публикация должна быть отклонена. |
| `gh_mirror_publish` | Публикация санитизированного дерева: один коммит поверх зеркальной ветки, fast-forward, **никогда не force**. `dryRun: true` — только превью; запись требует `confirm: true`. |

Allowlist — состав `package.json → files` плюс `.gitignore`, `LICENSE`, README-трио,
`CHANGELOG.md` и `cordis.patch.yml`. `docs/**` и инструкции агентов запрещены даже при
наличии в манифесте; поставляемый инструментарий вроде `scripts/**` публикуется, потому
что входит в пакет.

### Запуски workflow

| Инструмент | Что делает |
|---|---|
| `gh_run_list`, `gh_run_view` | Список запусков (фильтры по ветке, workflow, статусу) и чтение одного запуска. |
| `gh_run_jobs` | Джобы с шагами и отдельно — упавшие шаги; обычно этого достаточно для диагноза. |
| `gh_run_rerun`, `gh_run_cancel` | Перезапуск всех или только упавших джоб; отмена идущего запуска (нужно `confirm: true`). |
| `gh_run_logs` | Возвращает адрес архива логов: GitHub отвечает редиректом на zip, который не тянется в разговор. |

### Настройки репозитория

| Инструмент | Что делает |
|---|---|
| `gh_variable_list/set/delete` | Actions-переменные: в репозитории или в конкретном окружении. |
| `gh_secret_list/set/delete` | Actions-секреты. Установка использует sealed-box шифрование через опциональный `tweetnacl`; без него инструмент говорит, что установить, а не пишет испорченное значение. |
| `gh_ruleset_list/view/apply/delete` | Rulesets: чтение, создание, обновление, удаление. |
| `gh_branch_protection_get/set/delete` | Классическая защита веток: обязательные ревью, статус-чеки, принуждение для админов, флаги force-push и удаления. |

### Карточка настроек

Настройки живут на странице плагина (списочная посадка `plugins.item`, плюс посадка строки
и легаси `settings.plugin.item`): имя учётной записи, репозиторий по умолчанию, база API и
таймаут. Карточка проверяет **статус** снимка настроек и честно сообщает, когда сервис
настроек недоступен, вместо того чтобы рисовать рабочий на вид формы.

## Фоновые обзоры и команды

`gh_review_job` запускает обзор и сразу возвращает id задачи, `gh_review_job_status` читает
результат. Если в композиции есть реестр задач, работа видна и отменяема в интерфейсе; если
нет — выполняется внутри плагина.

Слэш-команды — быстрый путь для человека: `/pr create [title]`, `/review [number]`,
`/issue new <title> | list | show <number>`, `/gh [группа|инструмент]`. Команда **не пишет**
в GitHub сама: она передаёт модели инструкцию, поэтому запись всё равно проходит через
подтверждение.

## Безопасность

- Токен живёт в сервисе учётных данных DSH; в настройках только его имя.
- Чтение не меняет состояние; изменения подтверждаются явно; удаление репозитория, его
  перенос и удаление организации отклоняются сразу.
- Клиент никогда не печатает токен, а любая ошибка возвращается значением
  (`ok: false` с `status`, `code`, `rateLimit`), а не исключением.

## План

Блокеры релиза, по порядку:

1. **Паритет** — `pr_create`, `pr_update`, `pr_merge`, `gh_review`, `review_post`,
   `gh_issue`, `issue_open`, `issue_comment`, `issue_close`, `gh_search`,
   `gh_repo_search`, `gh_repo`, `gh_file`, `gh_checks`, `ci_run`.
2. **Зеркало** — `gh_mirror_check`, `gh_mirror_publish`: санитизированное дерево продукта
   (allowlist из `package.json → files`), один коммит поверх зеркальной ветки,
   fast-forward, никогда не force.
3. **Запуски workflow** — `gh_run_list/view/rerun/cancel/logs`.
4. **Настройки репозитория** — секреты, переменные, rulesets, защита веток,
   `gh_repo_create`, `gh_repo_edit`.
5. Карточка настроек на странице плагинов, локали `en`/`zh`, дизайн-контракт.

## Разработка

```bash
npm test        # node --test, без харнесса и без сети: fetch подменяется
```

## Лицензия

MIT — см. [LICENSE](LICENSE).
