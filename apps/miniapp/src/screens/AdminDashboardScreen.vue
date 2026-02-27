<template>
  <div class="shell fade-in">
    <header class="hero">
      <div class="kicker">Internal</div>
      <h1>Admin dashboard</h1>
      <p class="sub">UTC charts. Date range is <strong>inclusive</strong> for both From and To dates.</p>
    </header>

    <section class="card access">
      <div class="access-row">
        <label class="field grow">
          <span>Admin password</span>
          <input v-model="password" type="password" autocomplete="current-password" placeholder="••••••••" />
        </label>

        <div class="access-actions">
          <span class="status-pill" :class="{ ok: Boolean(password) }">
            {{ password ? 'Password set' : 'Locked' }}
          </span>
          <span v-if="activeStamp" class="status-pill subtle">Updated: {{ activeStamp }}</span>
          <button class="btn danger" type="button" :disabled="loading || feedbackLoading || usersLoading || previewLoading" @click="clearPassword">
            Clear
          </button>
        </div>
      </div>
      <p class="hint">
        Password is sent to admin endpoints as <code>X-Admin-Password</code>.
      </p>
    </section>

    <section class="tabs" role="tablist" aria-label="Admin sections">
      <button class="tab-btn" :class="{ active: activeTab === 'analytics' }" type="button" role="tab" @click="activeTab = 'analytics'">
        Analytics
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'users' }" type="button" role="tab" @click="activeTab = 'users'">
        Users
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'messaging' }" type="button" role="tab" @click="activeTab = 'messaging'">
        Messaging
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'feedback' }" type="button" role="tab" @click="activeTab = 'feedback'">
        Feedback
      </button>
    </section>

    <template v-if="activeTab === 'analytics'">
      <section class="card panel">
        <header class="panel-head">
          <div>
            <div class="panel-kicker">Analytics</div>
            <h2 class="panel-title">Metrics</h2>
            <p class="panel-sub">UTC charts. Date range is inclusive for both From and To dates.</p>
          </div>
          <div class="panel-actions">
            <button class="btn" type="button" :disabled="loading" @click="resetRange">Last 30d</button>
            <button class="btn" type="button" :disabled="loading" @click="applyRangePreset('last_week')">Last week</button>
            <button class="btn" type="button" :disabled="loading" @click="applyRangePreset('last_month')">Last month</button>
            <button class="btn primary" type="button" :disabled="!canFetch || loading" @click="refreshAnalytics">
              {{ loading ? 'Loading…' : 'Refresh' }}
            </button>
          </div>
        </header>

        <div class="panel-body">
          <div class="row">
            <label class="field">
              <span>From (UTC)</span>
              <input v-model="fromDate" type="date" />
            </label>

            <label class="field">
              <span>To (UTC, inclusive)</span>
              <input v-model="toDate" type="date" />
            </label>

            <label class="field">
              <span>Quick range</span>
              <select v-model="rangePreset" @change="applyRangePreset(rangePreset)">
                <option value="last_30_days">Last 30 days</option>
                <option value="last_week">Last week</option>
                <option value="last_month">Last month</option>
              </select>
            </label>
          </div>

          <div class="row">
            <label class="field grow">
              <span>Acquisition payload</span>
              <input
                v-model="payload"
                type="text"
                inputmode="text"
                autocomplete="off"
                placeholder="(optional)"
                list="payloads"
              />
              <datalist id="payloads">
                <option v-for="p in payloadOptions" :key="p.payload" :value="p.payload" />
              </datalist>
            </label>
          </div>

          <div v-if="!password" class="callout">
            Enter password above to load analytics.
          </div>
          <div v-else-if="errorText" class="callout error">
            {{ errorText }}
          </div>
        </div>
      </section>

      <section class="kpi-grid">
        <article class="kpi">
          <div class="kpi-label">Users (range)</div>
          <div class="kpi-value">
            {{ fmt(totals.active_users_in_range) }}
            <span class="kpi-value-sub">/ {{ fmt(totals.total_users_in_range) }}</span>
          </div>
          <div class="kpi-meta">All-time: {{ fmt(totals.active_users_all_time) }} / {{ fmt(totals.total_users_all_time) }}</div>
        </article>
        <article class="kpi">
          <div class="kpi-label">Inactive users</div>
          <div class="kpi-value">{{ fmt(totals.inactive_users_all_time) }}</div>
          <div class="kpi-meta">Permanent Telegram delivery failures</div>
        </article>
        <article class="kpi">
          <div class="kpi-label">Pro (range)</div>
          <div class="kpi-value">{{ fmt(totals.pro_users_in_range) }}</div>
          <div class="kpi-meta">All-time: {{ fmt(totals.pro_users_all_time) }}</div>
        </article>
      </section>

      <section class="card" v-if="botStats.length">
        <header class="bot-stats-head">
          <div class="kicker">Bot Statistics</div>
          <div class="sub">Per-bot user counts and activity metrics</div>
        </header>
        <div class="bot-table-wrap">
          <table class="bot-table">
            <thead>
              <tr>
                <th>
                  <button class="sort" type="button" @click="toggleBotSort('bot_key')">
                    Bot
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('bot_key') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleBotSort('base_lang')">
                    Base
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('base_lang') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleBotSort('target_lang')">
                    Target
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('target_lang') }}</span>
                  </button>
                </th>
                <th class="num">
                  <button class="sort" type="button" @click="toggleBotSort('users_last_3_days')">
                    Active (3d)
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('users_last_3_days') }}</span>
                  </button>
                </th>
                <th class="num">
                  <button class="sort" type="button" @click="toggleBotSort('users_last_7_days')">
                    Last 7d
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('users_last_7_days') }}</span>
                  </button>
                </th>
                <th class="num">
                  <button class="sort" type="button" @click="toggleBotSort('users_last_30_days')">
                    Last 30d
                    <span class="sort-ind" aria-hidden="true">{{ botSortIndicator('users_last_30_days') }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="bot in sortedBotStats" :key="bot.bot_key">
                <td class="bot">
                  <div class="bot-key">{{ bot.bot_key }}</div>
                  <div class="bot-meta">{{ fmt(bot.total_users) }} users</div>
                </td>
                <td>{{ bot.base_lang || '—' }}</td>
                <td>{{ bot.target_lang || '—' }}</td>
                <td class="num">{{ fmt(bot.users_last_3_days) }}</td>
                <td class="num">{{ fmt(bot.users_last_7_days) }}</td>
                <td class="num">{{ fmt(bot.users_last_30_days) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="charts-grid">
        <AdminChart
          title="New users by day"
          kind="bar"
          x-labels="all"
          :data="newUsersSeries"
          :series="[{ key: 'count', label: 'New users', color: 'rgba(199, 90, 36, 0.86)' }]"
        />

        <AdminChart
          title="New paid users by day (first time)"
          subtitle="Pro activations by day"
          kind="bar"
          x-labels="all"
          :data="newPaidSeries"
          :series="[
            { key: 'pro', label: 'Pro', color: 'rgba(199, 90, 36, 0.88)' }
          ]"
        />

        <AdminChart
          title="Action events by day"
          subtitle="Tracked product actions (stacked)"
          kind="bar"
          x-labels="all"
          :data="actionEventsSeries"
          :series="actionSeriesConfig"
        />

        <AdminChart
          title="Action funnel totals"
          subtitle="Total events in selected range"
          kind="bar"
          x-labels="all"
          :data="actionTotalsSeries"
          :series="[{ key: 'count', label: 'Events', color: 'rgba(87, 60, 127, 0.86)' }]"
        />

        <AdminChart
          title="Active users by day"
          subtitle="Active = at least one voice usage event that day"
          kind="bar"
          x-labels="all"
          :data="activeUsersSeries"
          :series="[{ key: 'count', label: 'Active users', color: 'rgba(31, 107, 99, 0.86)' }]"
        />

        <AdminChart
          title="Active users by day by bot"
          subtitle="Active users split by bot (stacked)"
          kind="bar"
          x-labels="all"
          :data="activeUsersByBotSeries"
          :series="activeUsersByBotSeriesConfig"
        />

        <AdminChart
          title="Inactive users by day"
          subtitle="Users marked inactive from permanent Telegram delivery failures"
          kind="bar"
          x-labels="all"
          :data="inactiveUsersSeries"
          :series="[{ key: 'count', label: 'Inactive users', color: 'rgba(174, 43, 40, 0.86)' }]"
        />

        <AdminChart
          title="Voice usage seconds by day"
          kind="line"
          x-labels="all"
          :data="usageSecondsSeries"
          :series="[
            { key: 'in_seconds', label: 'In', color: 'rgba(31, 107, 99, 0.9)' },
            { key: 'out_seconds', label: 'Out', color: 'rgba(199, 90, 36, 0.9)' }
          ]"
        />

        <AdminChart
          title="Active users by hour"
          subtitle="UTC hour-of-day distribution for selected range"
          kind="bar"
          x-labels="all"
          :data="activeUsersByHourSeries"
          :series="[{ key: 'count', label: 'Active users', color: 'rgba(31, 107, 99, 0.86)' }]"
        />

        <AdminChart
          title="Active users by hour today"
          subtitle="UTC, today only"
          kind="bar"
          x-labels="all"
          :data="activeUsersByHourTodaySeries"
          :series="[{ key: 'count', label: 'Active users', color: 'rgba(199, 90, 36, 0.86)' }]"
        />

        <AdminChart
          title="Voice usage seconds by hour today"
          subtitle="UTC, today only"
          kind="line"
          x-labels="all"
          :data="activeUsersByHourTodaySeries"
          :series="[
            { key: 'in_seconds', label: 'In', color: 'rgba(31, 107, 99, 0.9)' },
            { key: 'out_seconds', label: 'Out', color: 'rgba(46, 88, 142, 0.9)' }
          ]"
        />
      </section>
    </template>

    <template v-else-if="activeTab === 'users'">
      <section class="card panel">
        <header class="panel-head">
          <div>
            <div class="panel-kicker">Users</div>
            <h2 class="panel-title">Directory</h2>
            <p class="panel-sub">Server-side sorting and pagination. Range filters are UTC.</p>
          </div>
          <div class="panel-actions">
            <button class="btn" type="button" :disabled="usersLoading" @click="resetRange">Last 30d</button>
            <button class="btn" type="button" :disabled="usersLoading" @click="applyRangePreset('last_week')">Last week</button>
            <button class="btn" type="button" :disabled="usersLoading" @click="applyRangePreset('last_month')">Last month</button>
            <button class="btn primary" type="button" :disabled="!canFetch || usersLoading" @click="refreshUsersPage({ resetOffset: true })">
              {{ usersLoading ? 'Loading…' : 'Refresh users' }}
            </button>
          </div>
        </header>

        <div class="panel-body">
          <div class="row">
            <label class="field">
              <span>From (UTC)</span>
              <input v-model="fromDate" type="date" />
            </label>

            <label class="field">
              <span>To (UTC, inclusive)</span>
              <input v-model="toDate" type="date" />
            </label>

            <label class="field">
              <span>Quick range</span>
              <select v-model="rangePreset" @change="applyRangePreset(rangePreset)">
                <option value="last_30_days">Last 30 days</option>
                <option value="last_week">Last week</option>
                <option value="last_month">Last month</option>
              </select>
            </label>
          </div>

          <div class="row">
            <label class="field grow">
              <span>Acquisition payload</span>
              <input
                v-model="payload"
                type="text"
                inputmode="text"
                autocomplete="off"
                placeholder="(optional)"
                list="payloads"
              />
              <datalist id="payloads">
                <option v-for="p in payloadOptions" :key="p.payload" :value="p.payload" />
              </datalist>
            </label>
          </div>

          <div v-if="!password" class="callout">
            Enter password above to load users.
          </div>
          <div v-else-if="usersError" class="callout error">
            {{ usersError }}
          </div>
        </div>
      </section>

      <section class="card users-table-card">
        <div class="users-head">
          <div>
            <div class="kicker">Users</div>
            <h2>Users</h2>
          </div>
          <div class="users-meta">
            <span v-if="usersTotal">Showing {{ fmt(usersPageStart) }}–{{ fmt(usersPageEnd) }} of {{ fmt(usersTotal) }}</span>
            <span v-else>Total: 0</span>
            <label class="users-limit">
              <span>Rows</span>
              <select v-model.number="usersLimit" :disabled="usersLoading" @change="usersApplyLimit">
                <option :value="25">25</option>
                <option :value="50">50</option>
                <option :value="100">100</option>
                <option :value="200">200</option>
              </select>
            </label>
          </div>
        </div>

        <p class="hint" v-if="usersLoading && !usersRows.length">Loading users…</p>

        <div class="users-table-wrap" v-if="usersRows.length">
          <table class="users-table">
            <thead>
              <tr>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('created_at')">
                    Created
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('created_at') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('chat_id')">
                    Chat ID
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('chat_id') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('username')">
                    Username
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('username') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('first_name')">
                    Name
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('first_name') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('bot_key')">
                    Bot
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('bot_key') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('effective_tier')">
                    Tier
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('effective_tier') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('is_active')">
                    Active
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('is_active') }}</span>
                  </button>
                </th>
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('last_seen_at')">
                    Last seen
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('last_seen_at') }}</span>
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in usersRows" :key="row.chat_id">
                <td><time>{{ formatFeedbackTime(row.created_at) }}</time></td>
                <td><code>{{ row.chat_id }}</code></td>
                <td>{{ row.username ? `@${row.username}` : '—' }}</td>
                <td>{{ row.first_name || '—' }}</td>
                <td>{{ row.bot_key || '—' }}</td>
                <td>{{ displayTier(row.effective_tier) }}</td>
                <td>{{ row.is_active ? 'yes' : 'no' }}</td>
                <td>{{ row.last_seen_at ? formatFeedbackTime(row.last_seen_at) : '—' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p class="hint" v-else-if="!usersLoading">No users found for current filters.</p>

        <div class="feedback-pager">
          <button class="btn" type="button" :disabled="usersLoading || usersOffset <= 0" @click="usersPrevPage">
            Previous
          </button>
          <button class="btn" type="button" :disabled="usersLoading || !usersHasNext" @click="usersNextPage">
            Next
          </button>
        </div>
      </section>
    </template>

    <section class="card panel" v-else-if="activeTab === 'messaging'">
      <header class="panel-head">
        <div>
          <div class="panel-kicker">Messaging</div>
          <h2 class="panel-title">Broadcast</h2>
          <p class="panel-sub">Segment users, preview recipients, then send a message.</p>
        </div>
        <div class="panel-actions">
          <div class="counter-chip" :class="{ warn: Boolean(previewError) }">
            <div class="counter-chip-label">Will send to</div>
            <div class="counter-chip-value">{{ fmt(broadcastPreview.count) }}</div>
            <div class="counter-chip-meta" v-if="previewLoading">Updating…</div>
            <div class="counter-chip-meta" v-else-if="previewUpdatedAt">Updated: {{ previewUpdatedAt }}</div>
          </div>
        </div>
      </header>

      <div class="panel-body broadcast-layout">
        <section class="broadcast-pane">
          <div class="pane-title">Audience filters</div>

          <div class="row">
            <label class="field grow">
              <span>Username contains</span>
              <input
                v-model.trim="broadcast.username"
                type="text"
                autocomplete="off"
                inputmode="text"
                placeholder="(optional)"
              />
            </label>

            <label class="field">
              <span>Last activity</span>
              <select v-model="broadcast.lastActivityMode">
                <option value="any">Any</option>
                <option value="active_within">Active within X days</option>
                <option value="inactive_for">Inactive for X+ days</option>
                <option value="never_active">Never active</option>
              </select>
            </label>

            <label class="field" v-if="broadcast.lastActivityMode !== 'any' && broadcast.lastActivityMode !== 'never_active'">
              <span>X days</span>
              <input v-model.number="broadcast.lastActivityDays" type="number" min="1" max="3650" />
            </label>
          </div>

          <div class="row">
            <label class="field">
              <span>Usage filter</span>
              <select v-model="broadcast.usageMode">
                <option value="any">Any</option>
                <option value="reached">Limit reached</option>
                <option value="percent_gte">Usage >= X%</option>
              </select>
            </label>

            <label class="field" v-if="broadcast.usageMode === 'percent_gte'">
              <span>X percent</span>
              <input v-model.number="broadcast.usagePercent" type="number" min="0" max="100" />
            </label>

            <div class="field grow">
              <span>Current plan</span>
              <div class="plan-pills">
                <label class="pill">
                  <input v-model="broadcast.planFree" type="checkbox" />
                  <span>Free</span>
                </label>
                <label class="pill">
                  <input v-model="broadcast.planPro" type="checkbox" />
                  <span>Pro</span>
                </label>
              </div>
            </div>
          </div>

          <div class="row" v-if="botStats.length">
            <div class="field grow">
              <span>Bot</span>
              <div class="plan-pills">
                <label class="pill" :class="{ active: !hasSelectedBots }">
                  <input type="checkbox" :checked="!hasSelectedBots" @change="broadcast.botKeys = []" />
                  <span>All bots</span>
                </label>
                <label class="pill" v-for="bot in botStats" :key="bot.bot_key" :class="{ active: broadcast.botKeys.includes(bot.bot_key) }">
                  <input v-model="broadcast.botKeys" type="checkbox" :value="bot.bot_key" />
                  <span>{{ bot.bot_key }}</span>
                </label>
              </div>
            </div>
          </div>
        </section>

        <section class="broadcast-pane">
          <div class="pane-title">Message</div>

          <div class="row">
            <label class="field grow">
              <span>Message type</span>
              <select v-model="broadcast.messageKind">
                <option value="text">Text</option>
                <option value="photo">Image (photo)</option>
                <option value="video">Video</option>
              </select>
            </label>
          </div>

          <div class="row" v-if="broadcast.messageKind !== 'text'">
            <label class="field grow">
              <span>Media (upload to Telegram)</span>
              <input :accept="broadcastMediaAccept" type="file" @change="onBroadcastMediaPicked" />
              <small class="hint">Uploads once per selected bot and stores Telegram <code>file_id</code>s for the campaign.</small>
            </label>
            <div class="actions">
              <button
                class="btn"
                type="button"
                :disabled="!canUploadBroadcastMedia || mediaUploading"
                @click="uploadBroadcastMedia"
              >
                {{ mediaUploading ? 'Uploading…' : `Upload for ${fmt(broadcastUploadBots.length || 0)} bots` }}
              </button>
              <button class="btn danger" type="button" :disabled="mediaUploading" @click="clearBroadcastMedia">
                Clear
              </button>
            </div>
          </div>

          <div class="row" v-if="broadcast.messageKind !== 'text'">
            <label class="field grow">
              <span>Media URL (fallback)</span>
              <input
                v-model.trim="broadcast.mediaUrl"
                type="url"
                autocomplete="off"
                inputmode="url"
                placeholder="https://… (must be publicly accessible)"
              />
              <small class="hint">Optional fallback if you don’t want to upload.</small>
            </label>
          </div>

          <div class="row">
            <label class="field grow">
              <span>{{ broadcast.messageKind === 'text' ? 'Message text' : 'Caption (optional)' }}</span>
              <textarea
                v-model="broadcast.messageText"
                rows="6"
                :maxlength="broadcast.messageKind === 'text' ? 4096 : 1024"
                :placeholder="broadcast.messageKind === 'text'
                  ? 'Write the message that will be sent to each selected user…'
                  : 'Optional caption for the media message…'"
              />
              <small class="hint">
                Plain text only (Telegram HTML/Markdown is not enabled here).
              </small>
            </label>
          </div>

          <div class="row">
            <label class="field">
              <span>Confirm send</span>
              <input
                v-model.trim="broadcastConfirm"
                type="text"
                autocomplete="off"
                inputmode="text"
                placeholder="Type SEND"
              />
            </label>

            <div class="actions">
              <button class="btn" type="button" :disabled="!password || previewLoading" @click="refreshBroadcastPreview()">
                {{ previewLoading ? 'Preview…' : 'Refresh preview' }}
              </button>
              <button class="btn primary" type="button" :disabled="!canSendBroadcast || sendingBroadcast" @click="sendBroadcast">
                {{ sendingBroadcast ? 'Sending…' : `Send to ${fmt(broadcastPreview.count)}` }}
              </button>
            </div>
          </div>

          <div v-if="!password" class="callout">Enter admin password above to use broadcast.</div>
          <div v-else-if="!hasAnySelectedPlan" class="callout">Pick at least one plan.</div>
          <div v-else-if="broadcast.messageKind === 'text' && !broadcast.messageText.trim()" class="callout">Write a message to send.</div>
          <div
            v-else-if="broadcast.messageKind !== 'text' && !hasBroadcastMedia"
            class="callout"
          >
            Upload media (or provide a media URL).
          </div>
          <div v-else-if="mediaUploadError" class="callout error">{{ mediaUploadError }}</div>
          <div v-else-if="mediaUploadInfo" class="callout">{{ mediaUploadInfo }}</div>
          <div v-else-if="previewError" class="callout error">{{ previewError }}</div>
          <div v-else-if="sendError" class="callout error">{{ sendError }}</div>
          <div v-else-if="sendInfo" class="callout">{{ sendInfo }}</div>

          <div class="sample-card" v-if="broadcastPreview.sample.length">
            <div class="sample-title">Sample recipients</div>
            <div class="sample-table-wrap">
              <table class="sample-table">
                <thead>
                  <tr>
                    <th>Chat</th>
                    <th>Username</th>
                    <th>Bot</th>
                    <th>Tier</th>
                    <th>Last activity</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in broadcastPreview.sample.slice(0, 8)" :key="`${row.chat_id}-${row.bot_key}`">
                    <td><code>{{ row.chat_id }}</code></td>
                    <td>{{ row.username ? `@${row.username}` : '—' }}</td>
                    <td><span class="bot-badge">{{ row.bot_key }}</span></td>
                    <td>{{ displayTier(row.effective_tier) }}</td>
                    <td>{{ formatLastActivity(row.last_activity_at) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div class="campaign-state" v-if="campaignState">
            <div class="campaign-head">
              <strong>Campaign #{{ campaignState.id }}</strong>
              <span class="chip">{{ campaignState.status }}</span>
            </div>
            <div class="campaign-stats">
              <span>Total: {{ fmt(campaignState.total_recipients) }}</span>
              <span>Sent: {{ fmt(campaignState.sent_count) }}</span>
              <span>Failed: {{ fmt(campaignState.failed_count) }}</span>
              <span>Pending: {{ fmt(campaignState.pending_count) }}</span>
            </div>
            <p class="error" v-if="campaignState.error_text">{{ campaignState.error_text }}</p>
          </div>
        </section>
      </div>
    </section>

    <section class="card panel" v-else-if="activeTab === 'feedback'">
      <header class="panel-head">
        <div>
          <div class="panel-kicker">Feedback</div>
          <h2 class="panel-title">Inbox</h2>
          <p class="panel-sub">Per-user threads combining feedback messages and your replies.</p>
        </div>
        <div class="panel-actions">
          <span class="status-pill subtle" v-if="feedbackUpdatedAt">Updated: {{ feedbackUpdatedAt }}</span>
          <span class="status-pill">Threads: {{ fmt(feedbackTotal) }}</span>
          <button class="btn" type="button" :disabled="feedbackLoading" @click="resetFeedbackRange">Last 30d</button>
          <button class="btn primary" type="button" :disabled="!canFetchFeedback || feedbackLoading" @click="refreshFeedback({ resetOffset: true })">
            {{ feedbackLoading ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
      </header>

      <div class="panel-body">
        <div class="row">
          <label class="field">
            <span>From (UTC)</span>
            <input v-model="feedbackFromDate" type="date" />
          </label>
          <label class="field">
            <span>To (UTC, inclusive)</span>
            <input v-model="feedbackToDate" type="date" />
          </label>
          <label class="field">
            <span>Kind</span>
            <select v-model="feedbackKind">
              <option value="any">Any</option>
              <option value="text">Text</option>
              <option value="voice">Voice</option>
            </select>
          </label>
          <label class="field">
            <span>Status</span>
            <select v-model="feedbackStatus">
              <option value="active">Active</option>
              <option value="archived">Archived</option>
              <option value="all">All</option>
            </select>
          </label>
          <label class="field grow">
            <span>Search</span>
            <input
              v-model.trim="feedbackSearch"
              type="text"
              autocomplete="off"
              inputmode="text"
              placeholder="username, name, chat id, bot, or message text"
            />
          </label>
        </div>

        <div v-if="!password" class="callout">Enter admin password above to load feedback.</div>
        <div v-else-if="feedbackError" class="callout error">{{ feedbackError }}</div>

        <div class="feedback-list" v-if="feedbackThreads.length">
          <article class="feedback-item" v-for="thread in feedbackThreads" :key="thread.id">
            <div class="feedback-item-head feedback-thread-head">
              <div class="feedback-thread-title">
                <div class="feedback-meta">
                  <code>{{ thread.chat_id }}</code>
                  <code v-if="thread.bot_key">{{ thread.bot_key }}</code>
                  <span class="chip archived" v-if="thread.archived_at">archived</span>
                  <span class="feedback-user">{{ feedbackThreadName(thread) }}</span>
                </div>
                <div class="feedback-thread-stats">
                  <span>{{ fmt(thread.message_count) }} msgs</span>
                  <span>{{ fmt(thread.user_message_count) }} user</span>
                  <span>{{ fmt(thread.admin_message_count) }} admin</span>
                </div>
              </div>
              <div class="feedback-thread-times">
                <time>{{ formatFeedbackTime(thread.last_message_at) }}</time>
                <span class="hint" v-if="thread.first_message_at && thread.first_message_at !== thread.last_message_at">
                  Started {{ formatFeedbackTime(thread.first_message_at) }}
                </span>
              </div>
            </div>
            <div class="feedback-thread-preview" v-if="thread.latest_preview">
              {{ feedbackThreadPreview(thread) }}
            </div>
            <div class="feedback-thread-messages">
              <div
                class="feedback-message"
                :class="{ admin: msg.sender === 'admin', user: msg.sender === 'user' }"
                v-for="msg in thread.messages"
                :key="msg.id"
              >
                <div class="feedback-message-head">
                  <div class="feedback-meta">
                    <span class="chip" :class="{ admin: msg.sender === 'admin' }">
                      {{ msg.sender === 'admin' ? 'admin' : msg.kind }}
                    </span>
                    <span>{{ msg.sender === 'admin' ? (msg.created_by || 'admin') : feedbackMessageAuthor(thread, msg) }}</span>
                    <code v-if="msg.feedback_id">feedback #{{ msg.feedback_id }}</code>
                    <button
                      v-if="msg.sender === 'user' && msg.feedback_id"
                      class="feedback-inline-action"
                      type="button"
                      @click="startFeedbackReply(thread, msg)"
                    >
                      Reply to this
                    </button>
                  </div>
                  <time>{{ formatFeedbackTime(msg.created_at) }}</time>
                </div>
                <pre class="feedback-text">{{ msg.body || '(empty)' }}</pre>
                <p class="hint" v-if="msg.kind === 'voice' && msg.telegram_file_id">
                  Voice file id: <code>{{ msg.telegram_file_id }}</code>
                </p>
                <p class="hint" v-if="msg.sender === 'admin' && msg.reply_to_message_id">
                  Replied in Telegram thread.
                </p>
              </div>
            </div>
            <div class="feedback-actions">
              <button class="btn" type="button" @click="startFeedbackReply(thread)">
                {{ feedbackReplyOpenId === thread.id ? 'Close reply' : 'Reply to user' }}
              </button>
              <button
                class="btn"
                type="button"
                :disabled="feedbackThreadActionId === thread.id"
                @click="toggleFeedbackArchive(thread)"
              >
                {{ thread.archived_at ? 'Unarchive' : 'Archive' }}
              </button>
              <button
                class="btn danger"
                type="button"
                :disabled="feedbackThreadActionId === thread.id"
                @click="requestFeedbackDelete(thread.id)"
              >
                Delete
              </button>
              <p class="hint" v-if="feedbackReplyInfo[thread.id]">{{ feedbackReplyInfo[thread.id] }}</p>
              <p class="error" v-if="feedbackReplyError[thread.id]">{{ feedbackReplyError[thread.id] }}</p>
              <p class="hint" v-if="feedbackThreadActionInfo[thread.id]">{{ feedbackThreadActionInfo[thread.id] }}</p>
              <p class="error" v-if="feedbackThreadActionError[thread.id]">{{ feedbackThreadActionError[thread.id] }}</p>
            </div>
            <div class="feedback-delete" v-if="feedbackDeleteConfirm[thread.id]">
              <p class="hint">Delete this thread permanently? This removes user feedback and admin replies for this bot thread.</p>
              <div class="feedback-delete-actions">
                <button class="btn danger" type="button" :disabled="feedbackThreadActionId === thread.id" @click="deleteFeedbackThread(thread)">
                  {{ feedbackThreadActionId === thread.id ? 'Deleting…' : 'Confirm delete' }}
                </button>
                <button class="btn" type="button" :disabled="feedbackThreadActionId === thread.id" @click="cancelFeedbackDelete(thread.id)">
                  Cancel
                </button>
              </div>
            </div>
            <div class="feedback-reply" v-if="feedbackReplyOpenId === thread.id">
              <div class="feedback-reply-target" v-if="feedbackReplyTarget[thread.id]">
                <span class="chip">replying to {{ feedbackReplyTarget[thread.id].kind }}</span>
                <span>{{ feedbackReplyTarget[thread.id].label }}</span>
                <button class="feedback-inline-action" type="button" @click="setFeedbackReplyTarget(thread, latestUserMessage(thread))">
                  Use latest user message
                </button>
              </div>
              <label class="field grow">
                <span>Reply message</span>
                <textarea
                  v-model="feedbackReplyDraft[thread.id]"
                  maxlength="4096"
                  placeholder="Write a direct message to this user…"
                />
              </label>
              <div class="feedback-reply-foot">
                <span class="hint">{{ feedbackReplyLength(thread.id) }} / 4096</span>
                <button
                  class="btn primary"
                  type="button"
                  :disabled="!canSendFeedbackReply(thread.id)"
                  @click="sendFeedbackReply(thread)"
                >
                  {{ feedbackReplySendingId === thread.id ? 'Sending…' : 'Send message' }}
                </button>
              </div>
            </div>
          </article>
        </div>

        <p class="hint" v-else-if="password && !feedbackLoading">No feedback threads found for current filters.</p>

        <div class="feedback-pager">
          <button class="btn" type="button" :disabled="feedbackLoading || feedbackOffset <= 0" @click="feedbackPrevPage">
            Previous
          </button>
          <button class="btn" type="button" :disabled="feedbackLoading || !feedbackHasNext" @click="feedbackNextPage">
            Next
          </button>
        </div>
      </div>
    </section>

    <section class="card" v-else>
      <p class="hint">Select a tab.</p>
    </section>

    <footer class="foot">
      <button class="link" type="button" @click="emit('navigate', '/', { replace: true })">← Back to app</button>
      <span v-if="activeTab === 'analytics' && lastUpdated" class="stamp">Updated: {{ lastUpdated }}</span>
      <span v-else-if="activeTab === 'users' && usersUpdatedAt" class="stamp">Updated: {{ usersUpdatedAt }}</span>
      <span v-else-if="activeTab === 'feedback' && feedbackUpdatedAt" class="stamp">Updated: {{ feedbackUpdatedAt }}</span>
      <span v-else-if="activeTab === 'messaging' && previewUpdatedAt" class="stamp">Updated: {{ previewUpdatedAt }}</span>
    </footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiJson } from '../lib/api.js';
import AdminChart from '../components/AdminChart.vue';

const props = defineProps({
  apiBase: { type: String, required: true }
});

const emit = defineEmits(['navigate']);

const DAY_MS = 24 * 60 * 60 * 1000;

function dateToYmdUtc(d) {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function defaultRange() {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const to = todayUtc;
  const from = new Date(to.getTime() - 29 * DAY_MS);
  return { from: dateToYmdUtc(from), to: dateToYmdUtc(to) };
}

function parseYmdAsUtc(ymd) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return null;
  const d = new Date(`${ymd}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) ? d : null;
}

function toExclusiveBoundaryYmd(inclusiveYmd) {
  const d = parseYmdAsUtc(inclusiveYmd);
  if (!d) return inclusiveYmd;
  return dateToYmdUtc(new Date(d.getTime() + DAY_MS));
}

function rangeForPreset(preset) {
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (preset === 'last_week') {
    const day = todayUtc.getUTCDay();
    const daysFromMonday = (day + 6) % 7;
    const thisWeekStart = new Date(todayUtc.getTime() - daysFromMonday * DAY_MS);
    const prevWeekStart = new Date(thisWeekStart.getTime() - 7 * DAY_MS);
    const prevWeekEnd = new Date(thisWeekStart.getTime() - DAY_MS);
    return { from: dateToYmdUtc(prevWeekStart), to: dateToYmdUtc(prevWeekEnd) };
  }
  if (preset === 'last_month') {
    const thisMonthStart = new Date(Date.UTC(todayUtc.getUTCFullYear(), todayUtc.getUTCMonth(), 1));
    const prevMonthStart = new Date(Date.UTC(thisMonthStart.getUTCFullYear(), thisMonthStart.getUTCMonth() - 1, 1));
    const prevMonthEnd = new Date(thisMonthStart.getTime() - DAY_MS);
    return { from: dateToYmdUtc(prevMonthStart), to: dateToYmdUtc(prevMonthEnd) };
  }
  return defaultRange();
}

const password = ref('');
const activeTab = ref('analytics');
const { from: defaultFrom, to: defaultTo } = defaultRange();
const fromDate = ref(defaultFrom);
const toDate = ref(defaultTo);
const rangePreset = ref('last_30_days');
const payload = ref('');
const payloadOptions = ref([]);
const feedbackFromDate = ref(defaultFrom);
const feedbackToDate = ref(defaultTo);
const feedbackKind = ref('any');
const feedbackStatus = ref('active');
const feedbackSearch = ref('');
const feedbackThreads = ref([]);
const feedbackTotal = ref(0);
const feedbackOffset = ref(0);
const feedbackLimit = 40;
const feedbackLoading = ref(false);
const feedbackError = ref('');
const feedbackUpdatedAt = ref('');
const feedbackReplyDraft = reactive({});
const feedbackReplyOpenId = ref(null);
const feedbackReplySendingId = ref(null);
const feedbackReplyError = reactive({});
const feedbackReplyInfo = reactive({});
const feedbackReplyTarget = reactive({});
const feedbackThreadActionId = ref(null);
const feedbackThreadActionError = reactive({});
const feedbackThreadActionInfo = reactive({});
const feedbackDeleteConfirm = reactive({});

const loading = ref(false);
const errorText = ref('');
const lastUpdated = ref('');
const previewUpdatedAt = ref('');

const totals = ref({
  total_users_all_time: 0,
  active_users_all_time: 0,
  inactive_users_all_time: 0,
  pro_users_all_time: 0,
  total_users_in_range: 0,
  active_users_in_range: 0,
  inactive_users_in_range: 0,
  pro_users_in_range: 0
});

const botStats = ref([]);

const botSort = reactive({
  key: 'users_last_3_days',
  dir: 'desc' // 'asc' | 'desc'
});

const newUsersSeries = ref([]);
const newPaidSeries = ref([]);
const actionEventsSeries = ref([]);
const actionTotalsSeries = ref([]);
const activeUsersSeries = ref([]);
const activeUsersByBotSeries = ref([]);
const activeUsersByBotSeriesConfig = ref([]);
const inactiveUsersSeries = ref([]);
const usageSecondsSeries = ref([]);
const activeUsersByHourSeries = ref([]);
const activeUsersByHourTodaySeries = ref([]);
const actionSeriesConfig = [
  { key: 'start', label: 'start', color: 'rgba(31, 107, 99, 0.88)' },
  { key: 'profile_set_level', label: 'profile_set_level', color: 'rgba(199, 90, 36, 0.88)' },
  { key: 'first_voice_sent', label: 'first_voice_sent', color: 'rgba(46, 88, 142, 0.88)' },
  { key: 'first_answer_delivered', label: 'first_answer_delivered', color: 'rgba(103, 78, 167, 0.88)' },
  { key: 'paywall_shown', label: 'paywall_shown', color: 'rgba(174, 43, 40, 0.86)' },
  { key: 'purchase_success', label: 'purchase_success', color: 'rgba(117, 156, 56, 0.88)' },
  { key: 'day1_return', label: 'day1_return', color: 'rgba(33, 124, 146, 0.88)' }
];
const usersRows = ref([]);
const usersTotal = ref(0);
const usersOffset = ref(0);
const usersLimit = ref(50);
const usersLoading = ref(false);
const usersError = ref('');
const usersUpdatedAt = ref('');
const usersSort = reactive({
  key: 'created_at',
  dir: 'desc' // 'asc' | 'desc'
});

const usersPageStart = computed(() => (usersTotal.value ? usersOffset.value + 1 : 0));
const usersPageEnd = computed(() => Math.min(usersOffset.value + usersRows.value.length, usersTotal.value));

const activeStamp = computed(() => {
  if (activeTab.value === 'analytics') return lastUpdated.value || '';
  if (activeTab.value === 'users') return usersUpdatedAt.value || '';
  if (activeTab.value === 'messaging') return previewUpdatedAt.value || '';
  if (activeTab.value === 'feedback') return feedbackUpdatedAt.value || '';
  return '';
});

function usersSortIndicator(key) {
  if (usersSort.key !== key) return '';
  return usersSort.dir === 'asc' ? '↑' : '↓';
}

function toggleUsersSort(key) {
  if (usersSort.key === key) {
    usersSort.dir = usersSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    usersSort.key = key;
    usersSort.dir = key === 'created_at' || key === 'last_seen_at' ? 'desc' : 'asc';
  }
  usersOffset.value = 0;
  refreshUsersPage({ resetOffset: true });
}

function usersApplyLimit() {
  usersOffset.value = 0;
  refreshUsersPage({ resetOffset: true });
}
const previewLoading = ref(false);
const previewError = ref('');
const sendError = ref('');
const sendInfo = ref('');
const sendingBroadcast = ref(false);
const broadcastConfirm = ref('');
const campaignState = ref(null);
const broadcastPreview = reactive({
  count: 0,
  sample: []
});
const broadcast = reactive({
  username: '',
  planFree: true,
  planPro: true,
  lastActivityMode: 'any',
  lastActivityDays: 14,
  usageMode: 'any',
  usagePercent: 80,
  messageKind: 'text',
  mediaUrl: '',
  mediaFileIds: {},
  messageText: '',
  botKeys: []
});

const broadcastMediaFile = ref(null);
const mediaUploading = ref(false);
const mediaUploadError = ref('');
const mediaUploadInfo = ref('');

const broadcastMediaAccept = computed(() => (broadcast.messageKind === 'photo' ? 'image/*' : 'video/*'));

const broadcastUploadBots = computed(() => {
  if (broadcast.botKeys.length > 0) {
    return Array.from(
      new Set(
        broadcast.botKeys
          .map((v) => (v ?? '').toString().trim().toLowerCase())
          .filter((v) => v.length > 0 && v.length <= 32)
      )
    );
  }
  if (botStats.value.length > 0) {
    return Array.from(
      new Set(
        botStats.value
          .map((b) => (b?.bot_key ?? '').toString().trim().toLowerCase())
          .filter((v) => v.length > 0 && v.length <= 32)
      )
    );
  }
  return [];
});

const hasBroadcastMedia = computed(() => {
  const mediaUrl = broadcast.mediaUrl.trim();
  const ids = broadcast.mediaFileIds && typeof broadcast.mediaFileIds === 'object' ? broadcast.mediaFileIds : {};
  const hasFileIds = Object.keys(ids).length > 0;
  return Boolean(mediaUrl || hasFileIds);
});

const canUploadBroadcastMedia = computed(() => {
  if (!password.value) return false;
  if (broadcast.messageKind === 'text') return false;
  if (!broadcastMediaFile.value) return false;
  if (broadcastUploadBots.value.length === 0) return false;
  return true;
});

function clearBroadcastMedia() {
  broadcastMediaFile.value = null;
  broadcast.mediaUrl = '';
  broadcast.mediaFileIds = {};
  mediaUploadError.value = '';
  mediaUploadInfo.value = '';
}

function onBroadcastMediaPicked(event) {
  const input = event?.target;
  const file = input?.files?.[0] || null;
  broadcastMediaFile.value = file;
  mediaUploadError.value = '';
  mediaUploadInfo.value = '';
  broadcast.mediaFileIds = {};
}

async function uploadBroadcastMedia() {
  if (!canUploadBroadcastMedia.value) return;
  if (!broadcastMediaFile.value) return;

  mediaUploading.value = true;
  mediaUploadError.value = '';
  mediaUploadInfo.value = '';

  try {
    const headers = adminHeaders();
    const form = new FormData();
    form.append('messageKind', broadcast.messageKind);
    form.append('bots', JSON.stringify(broadcastUploadBots.value));
    form.append('file', broadcastMediaFile.value);

    const data = await apiJson(props.apiBase, '/admin/broadcasts/upload-media', {
      method: 'POST',
      headers,
      body: form
    });

    const ids = data?.mediaFileIds && typeof data.mediaFileIds === 'object' ? data.mediaFileIds : {};
    broadcast.mediaFileIds = ids;
    broadcast.mediaUrl = '';
    mediaUploadInfo.value = `Uploaded and stored media for ${fmt(Object.keys(ids).length)} bot(s).`;
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    mediaUploadError.value = `Upload failed: ${msg}`;
  } finally {
    mediaUploading.value = false;
  }
}

let previewTimer = null;
let campaignPollTimer = null;

function parseBotKeyLangs(botKey) {
  const s = String(botKey || '').trim();
  if (!s) return { base_lang: '', target_lang: '' };
  const parts = s.split(/[-_]/g).filter(Boolean);
  if (parts.length >= 2) return { base_lang: parts[0], target_lang: parts[1] };
  return { base_lang: parts[0] || '', target_lang: '' };
}

function botSortIndicator(key) {
  if (botSort.key !== key) return '';
  return botSort.dir === 'asc' ? '↑' : '↓';
}

function toggleBotSort(key) {
  if (botSort.key === key) {
    botSort.dir = botSort.dir === 'asc' ? 'desc' : 'asc';
    return;
  }
  botSort.key = key;
  botSort.dir = key === 'bot_key' || key === 'base_lang' || key === 'target_lang' ? 'asc' : 'desc';
}

function safeNum(value) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function cmp(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

const botStatsTable = computed(() =>
  (Array.isArray(botStats.value) ? botStats.value : []).map((bot) => {
    const langs = parseBotKeyLangs(bot?.bot_key);
    return {
      ...bot,
      ...langs,
      total_users: safeNum(bot?.total_users),
      active_users: safeNum(bot?.active_users),
      users_last_3_days: safeNum(bot?.users_last_3_days),
      users_last_7_days: safeNum(bot?.users_last_7_days),
      users_last_30_days: safeNum(bot?.users_last_30_days)
    };
  })
);

const sortedBotStats = computed(() => {
  const rows = botStatsTable.value.slice();
  const dir = botSort.dir === 'asc' ? 1 : -1;
  const key = botSort.key;

  rows.sort((ra, rb) => {
    const a = ra?.[key];
    const b = rb?.[key];

    const isText = key === 'bot_key' || key === 'base_lang' || key === 'target_lang';
    if (isText) {
      const av = String(a || '');
      const bv = String(b || '');
      const primary = av.localeCompare(bv);
      if (primary) return primary * dir;
      return String(ra.bot_key || '').localeCompare(String(rb.bot_key || ''));
    }

    const primary = cmp(safeNum(a), safeNum(b));
    if (primary) return primary * dir;
    return String(ra.bot_key || '').localeCompare(String(rb.bot_key || ''));
  });

  return rows;
});

const canFetch = computed(() => {
  if (!password.value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate.value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(toDate.value)) return false;
  return fromDate.value <= toDate.value;
});
const canFetchFeedback = computed(() => {
  if (!password.value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(feedbackFromDate.value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(feedbackToDate.value)) return false;
  return feedbackFromDate.value <= feedbackToDate.value;
});
const feedbackHasNext = computed(() => feedbackOffset.value + feedbackThreads.value.length < feedbackTotal.value);
const usersHasNext = computed(() => usersOffset.value + usersRows.value.length < usersTotal.value);

function adminHeaders() {
  return { 'X-Admin-Password': password.value };
}

async function refreshBotStats() {
  if (!password.value) return;
  try {
    const headers = adminHeaders();
    const botStatsData = await apiJson(props.apiBase, '/admin/metrics/bot-stats', { headers });
    botStats.value = Array.isArray(botStatsData?.bots) ? botStatsData.bots : [];
  } catch (err) {
    console.error(err);
  }
}

function clampInt(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const int = Math.trunc(num);
  if (int < min) return min;
  if (int > max) return max;
  return int;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function transformByBotData(rows) {
  // Transform rows like [{ day, bot_key, count }, ...] 
  // into [{ day, uk_en: count, uk_de: count }, ...]
  const byDay = {};
  const botsSet = new Set();
  
  for (const row of rows) {
    const day = row.day;
    const botKey = row.bot_key || 'unknown';
    const count = Number(row.count || 0);
    
    botsSet.add(botKey);
    
    if (!byDay[day]) {
      byDay[day] = { day };
    }
    
    // Convert bot-key to valid JS property key (replace '-' with '_')
    const safeKey = botKey.replace(/-/g, '_');
    byDay[day][safeKey] = count;
  }
  
  // Convert to array and sort by day
  const chartData = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
  
  // Build series config dynamically
  const botColors = {
    'uk_en': 'rgba(31, 107, 99, 0.88)',    // Teal for English
    'uk_de': 'rgba(199, 90, 36, 0.88)',    // Orange for German
  };
  
  const seriesConfig = Array.from(botsSet)
    .sort()
    .map(botKey => {
      const safeKey = botKey.replace(/-/g, '_');
      return {
        key: safeKey,
        label: botKey,
        color: botColors[safeKey] || 'rgba(100, 100, 100, 0.85)'
      };
    });
  
  return { chartData, seriesConfig };
}

function query() {
  return {
    from: fromDate.value,
    to: toExclusiveBoundaryYmd(toDate.value),
    payload: payload.value.trim() ? payload.value.trim() : undefined
  };
}

function feedbackQuery() {
  return {
    from: feedbackFromDate.value,
    to: toExclusiveBoundaryYmd(feedbackToDate.value),
    kind: feedbackKind.value !== 'any' ? feedbackKind.value : undefined,
    status: feedbackStatus.value !== 'all' ? feedbackStatus.value : undefined,
    search: feedbackSearch.value.trim() ? feedbackSearch.value.trim() : undefined,
    limit: feedbackLimit,
    offset: feedbackOffset.value
  };
}

function fmt(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0';
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

function isoStampNow() {
  const d = new Date();
  return d.toISOString().replace('T', ' ').replace('Z', 'Z');
}

function formatLastActivity(raw) {
  if (!raw) return 'never active';
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return 'unknown';
  const now = Date.now();
  const days = Math.floor((now - d.getTime()) / DAY_MS);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

function formatFeedbackTime(raw) {
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return 'unknown time';
  return d.toISOString().replace('T', ' ').replace('Z', 'Z');
}

function displayTier(rawTier) {
  const tier = (rawTier || '').toString().toLowerCase();
  if (tier === 'free') return 'free';
  if (tier === 'pro') return 'pro';
  return 'pro';
}

function actionLabel(rawAction) {
  return (rawAction || '')
    .toString()
    .trim()
    .replaceAll('_', ' ');
}

function feedbackThreadName(thread) {
  if (thread?.username) return `@${thread.username}`;
  if (thread?.first_name) return thread.first_name;
  return 'unknown user';
}

function feedbackThreadPreview(thread) {
  const text = String(thread?.latest_preview || '').trim();
  if (!text) return '';
  return text.length > 180 ? `${text.slice(0, 180)}…` : text;
}

function feedbackMessageAuthor(thread, message) {
  if (message?.username) return `@${message.username}`;
  if (message?.first_name) return message.first_name;
  return feedbackThreadName(thread);
}

function latestUserMessage(thread) {
  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
    const msg = messages[idx];
    if (msg?.sender === 'user' && Number(msg?.feedback_id) > 0) return msg;
  }
  return null;
}

function feedbackReplyTargetLabel(message) {
  if (!message) return 'latest user message';
  const author = message.username ? `@${message.username}` : (message.first_name || 'user');
  const time = formatFeedbackTime(message.created_at);
  return `${author} • ${time}`;
}

function clearFeedbackReplyState({ clearDrafts = true } = {}) {
  feedbackReplyOpenId.value = null;
  feedbackReplySendingId.value = null;
  feedbackThreadActionId.value = null;

  Object.keys(feedbackReplyError).forEach((key) => {
    delete feedbackReplyError[key];
  });
  Object.keys(feedbackReplyInfo).forEach((key) => {
    delete feedbackReplyInfo[key];
  });
  Object.keys(feedbackReplyTarget).forEach((key) => {
    delete feedbackReplyTarget[key];
  });
  Object.keys(feedbackThreadActionError).forEach((key) => {
    delete feedbackThreadActionError[key];
  });
  Object.keys(feedbackThreadActionInfo).forEach((key) => {
    delete feedbackThreadActionInfo[key];
  });
  Object.keys(feedbackDeleteConfirm).forEach((key) => {
    delete feedbackDeleteConfirm[key];
  });

  if (clearDrafts) {
    Object.keys(feedbackReplyDraft).forEach((key) => {
      delete feedbackReplyDraft[key];
    });
  }
}

function setFeedbackReplyTarget(thread, message) {
  const key = String(thread?.id ?? '').trim();
  if (!key) return;
  const targetMessage = message && Number(message?.feedback_id) > 0 ? message : latestUserMessage(thread);
  if (!targetMessage) {
    delete feedbackReplyTarget[key];
    return;
  }
  feedbackReplyTarget[key] = {
    feedbackId: Number(targetMessage.feedback_id),
    kind: targetMessage.kind || 'text',
    label: feedbackReplyTargetLabel(targetMessage)
  };
}

function startFeedbackReply(thread, message = null) {
  const key = String(thread?.id ?? '').trim();
  if (feedbackReplyOpenId.value === key) {
    if (!message) {
      feedbackReplyOpenId.value = null;
      return;
    }
  }
  feedbackReplyOpenId.value = key;
  if (typeof feedbackReplyDraft[key] !== 'string') {
    feedbackReplyDraft[key] = '';
  }
  setFeedbackReplyTarget(thread, message);
  feedbackReplyError[key] = '';
  feedbackReplyInfo[key] = '';
}

function feedbackReplyLength(threadId) {
  const key = String(threadId);
  return String(feedbackReplyDraft[key] || '').length;
}

function canSendFeedbackReply(threadId) {
  const key = String(threadId);
  if (!password.value) return false;
  if (feedbackReplySendingId.value !== null || feedbackThreadActionId.value !== null) return false;
  const text = String(feedbackReplyDraft[key] || '').trim();
  if (!text) return false;
  if (text.length > 4096) return false;
  return true;
}

function requestFeedbackDelete(threadId) {
  const key = String(threadId);
  feedbackDeleteConfirm[key] = true;
  feedbackThreadActionError[key] = '';
  feedbackThreadActionInfo[key] = '';
}

function cancelFeedbackDelete(threadId) {
  const key = String(threadId);
  delete feedbackDeleteConfirm[key];
}

function removeFeedbackThreadLocal(threadId) {
  const key = String(threadId);
  const before = feedbackThreads.value.length;
  feedbackThreads.value = feedbackThreads.value.filter((thread) => thread.id !== key);
  if (feedbackThreads.value.length !== before && feedbackTotal.value > 0) {
    feedbackTotal.value -= 1;
  }
  delete feedbackReplyDraft[key];
  delete feedbackReplyError[key];
  delete feedbackReplyInfo[key];
  delete feedbackThreadActionError[key];
  delete feedbackThreadActionInfo[key];
  delete feedbackDeleteConfirm[key];
  if (feedbackReplyOpenId.value === key) feedbackReplyOpenId.value = null;
}

async function toggleFeedbackArchive(thread) {
  const key = String(thread?.id ?? '').trim();
  if (!key) return;
  if (!password.value) {
    feedbackThreadActionError[key] = 'Enter admin password first.';
    return;
  }

  feedbackThreadActionId.value = key;
  feedbackThreadActionError[key] = '';
  feedbackThreadActionInfo[key] = '';
  try {
    const headers = adminHeaders();
    const body = { chatId: thread.chat_id, botKey: thread.bot_key };
    const endpoint = thread.archived_at ? '/admin/feedbacks/thread/unarchive' : '/admin/feedbacks/thread/archive';
    const data = await apiJson(props.apiBase, endpoint, { method: 'POST', headers, body });

    if (feedbackStatus.value === 'all') {
      thread.archived_at = data?.archived_at || null;
      thread.archived_by = data?.archived_by || null;
      feedbackThreadActionInfo[key] = thread.archived_at ? 'Thread archived.' : 'Thread restored to active.';
    } else if (feedbackStatus.value === 'active' && !thread.archived_at) {
      removeFeedbackThreadLocal(key);
    } else if (feedbackStatus.value === 'archived' && thread.archived_at) {
      removeFeedbackThreadLocal(key);
    }
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    feedbackThreadActionError[key] = `Action failed: ${msg}`;
  } finally {
    feedbackThreadActionId.value = null;
  }
}

async function deleteFeedbackThread(thread) {
  const key = String(thread?.id ?? '').trim();
  if (!key) return;
  if (!password.value) {
    feedbackThreadActionError[key] = 'Enter admin password first.';
    return;
  }

  feedbackThreadActionId.value = key;
  feedbackThreadActionError[key] = '';
  feedbackThreadActionInfo[key] = '';
  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/feedbacks/thread/delete', {
      method: 'POST',
      headers,
      body: { chatId: thread.chat_id, botKey: thread.bot_key }
    });
    removeFeedbackThreadLocal(key);
    feedbackThreadActionInfo[key] = `Deleted ${fmt(data?.deleted_feedback_count || 0)} feedback and ${fmt(data?.deleted_reply_count || 0)} replies.`;
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    feedbackThreadActionError[key] = `Delete failed: ${msg}`;
  } finally {
    feedbackThreadActionId.value = null;
  }
}

async function sendFeedbackReply(thread) {
  const key = String(thread?.id ?? '').trim();
  const feedbackId = Number(feedbackReplyTarget[key]?.feedbackId || thread?.latest_feedback_id);
  if (!key) return;

  if (!password.value) {
    feedbackReplyError[key] = 'Enter admin password first.';
    return;
  }
  if (!Number.isFinite(feedbackId) || feedbackId <= 0) {
    feedbackReplyError[key] = 'Cannot reply: thread is missing a feedback anchor.';
    return;
  }

  const messageText = String(feedbackReplyDraft[key] || '').trim();
  if (!messageText) {
    feedbackReplyError[key] = 'Message cannot be empty.';
    return;
  }
  if (messageText.length > 4096) {
    feedbackReplyError[key] = 'Message is too long (max 4096 chars).';
    return;
  }

  feedbackReplySendingId.value = key;
  feedbackReplyError[key] = '';
  feedbackReplyInfo[key] = '';
  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, `/admin/feedbacks/${feedbackId}/reply`, {
      method: 'POST',
      headers,
      body: {
        messageText,
        replyToFeedbackId: feedbackId
      }
    });

    const reply = data?.reply && typeof data.reply === 'object' ? data.reply : null;
    if (reply) {
      if (!Array.isArray(thread.messages)) thread.messages = [];
      thread.messages.push({
        id: `admin:${reply.id || Date.now()}`,
        sender: 'admin',
        kind: 'text',
        created_at: reply.created_at || new Date().toISOString(),
        feedback_id: feedbackId,
        username: null,
        first_name: null,
        created_by: reply.created_by || 'admin_dashboard',
        message_id: null,
        telegram_message_id: Number(reply.telegram_message_id || 0) || null,
        reply_to_message_id: Number(reply.reply_to_message_id || 0) || null,
        telegram_file_id: null,
        body: reply.body || messageText
      });
      thread.message_count = Number(thread.message_count || 0) + 1;
      thread.admin_message_count = Number(thread.admin_message_count || 0) + 1;
      thread.last_message_at = reply.created_at || new Date().toISOString();
      thread.latest_preview = reply.body || messageText;
      if (!thread.first_message_at) thread.first_message_at = thread.last_message_at;
    }
    thread.archived_at = null;
    thread.archived_by = null;

    if (feedbackStatus.value === 'archived') {
      removeFeedbackThreadLocal(key);
      return;
    }

    feedbackReplyDraft[key] = '';
    feedbackReplyOpenId.value = null;
    delete feedbackReplyTarget[key];
    const telegramMessageId = Number(data?.telegram_message_id || 0);
    const detail = Number.isFinite(telegramMessageId) && telegramMessageId > 0
      ? `Telegram msg #${telegramMessageId}`
      : 'Message sent';
    feedbackReplyInfo[key] = `${detail} at ${isoStampNow()}.`;
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    feedbackReplyError[key] = `Send failed: ${msg}`;
  } finally {
    feedbackReplySendingId.value = null;
  }
}

const selectedPlans = computed(() => {
  const plans = [];
  if (broadcast.planFree) plans.push('free');
  if (broadcast.planPro) plans.push('pro');
  return plans;
});

const hasAnySelectedPlan = computed(() => selectedPlans.value.length > 0);
const hasSelectedBots = computed(() => broadcast.botKeys.length > 0);

function broadcastFiltersPayload() {
  const filters = {};
  if (broadcast.username.trim()) filters.username = broadcast.username.trim();

  if (selectedPlans.value.length > 0 && selectedPlans.value.length < 2) {
    filters.plans = selectedPlans.value;
  }

  if (broadcast.lastActivityMode !== 'any') {
    filters.lastActivityMode = broadcast.lastActivityMode;
    if (broadcast.lastActivityMode !== 'never_active') {
      filters.lastActivityDays = clampInt(broadcast.lastActivityDays, 1, 3650, 14);
    }
  }

  if (broadcast.usageMode !== 'any') {
    filters.usageMode = broadcast.usageMode;
    if (broadcast.usageMode === 'percent_gte') {
      filters.usagePercent = clampNumber(broadcast.usagePercent, 0, 100, 80);
    }
  }

  if (broadcast.botKeys.length > 0) {
    filters.bots = Array.from(
      new Set(
        broadcast.botKeys
          .map((v) => (v ?? '').toString().trim().toLowerCase())
          .filter((v) => v.length > 0 && v.length <= 32)
      )
    );
  }

  return filters;
}

const canSendBroadcast = computed(() => {
  const message = broadcast.messageText.trim();
  const mediaUrl = broadcast.mediaUrl.trim();
  const mediaFileIds = broadcast.mediaFileIds && typeof broadcast.mediaFileIds === 'object' ? broadcast.mediaFileIds : {};
  const hasFileIds = Object.keys(mediaFileIds).length > 0;
  if (!password.value) return false;
  if (!hasAnySelectedPlan.value) return false;
  if (broadcast.messageKind === 'text') {
    if (!message) return false;
    if (message.length > 4096) return false;
  } else {
    if (!mediaUrl && !hasFileIds) return false;
    if (mediaUrl && mediaUrl.length > 2048) return false;
    if (message.length > 1024) return false;
  }
  if (broadcastPreview.count <= 0) return false;
  if (broadcastConfirm.value.toUpperCase() !== 'SEND') return false;
  return true;
});

function stopCampaignPolling() {
  if (!campaignPollTimer) return;
  window.clearInterval(campaignPollTimer);
  campaignPollTimer = null;
}

async function loadCampaignStatus(campaignId) {
  if (!password.value) return;
  const headers = adminHeaders();
  const data = await apiJson(props.apiBase, `/admin/broadcasts/${campaignId}`, { headers });
  campaignState.value = data?.campaign || null;
  const status = campaignState.value?.status || '';
  if (status === 'completed' || status === 'failed') {
    stopCampaignPolling();
  }
}

function startCampaignPolling(campaignId) {
  stopCampaignPolling();
  campaignPollTimer = window.setInterval(() => {
    loadCampaignStatus(campaignId).catch((err) => {
      console.error(err);
      stopCampaignPolling();
    });
  }, 2000);
}

async function refreshBroadcastPreview({ silent = false } = {}) {
  if (!password.value) return;
  if (!hasAnySelectedPlan.value) {
    broadcastPreview.count = 0;
    broadcastPreview.sample = [];
    previewError.value = '';
    return;
  }

  previewLoading.value = true;
  if (!silent) previewError.value = '';
  try {
    const headers = adminHeaders();
    const body = { filters: broadcastFiltersPayload() };
    const data = await apiJson(props.apiBase, '/admin/broadcasts/preview', {
      method: 'POST',
      headers,
      body
    });
    const nextCount = Number(data?.count || 0);
    broadcastPreview.count = Number.isFinite(nextCount) ? nextCount : 0;
    broadcastPreview.sample = Array.isArray(data?.sample) ? data.sample : [];
    previewUpdatedAt.value = isoStampNow();
    previewError.value = '';
  } catch (err) {
    console.error(err);
    broadcastPreview.count = 0;
    broadcastPreview.sample = [];
    previewUpdatedAt.value = '';
    const msg = err?.payload?.error || err?.message || 'request_failed';
    previewError.value = `Preview failed: ${msg}`;
  } finally {
    previewLoading.value = false;
  }
}

function scheduleBroadcastPreview() {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (!password.value) return;
  previewTimer = window.setTimeout(() => {
    refreshBroadcastPreview({ silent: true });
    previewTimer = null;
  }, 320);
}

async function sendBroadcast() {
  if (!canSendBroadcast.value) return;

  sendingBroadcast.value = true;
  sendError.value = '';
  sendInfo.value = '';

  try {
    const headers = adminHeaders();
    const mediaFileIds =
      broadcast.messageKind === 'text' ? null : (broadcast.mediaFileIds && typeof broadcast.mediaFileIds === 'object' ? broadcast.mediaFileIds : null);
    const hasMediaFileIds = Boolean(mediaFileIds && Object.keys(mediaFileIds).length > 0);
    const payloadBody = {
      filters: broadcastFiltersPayload(),
      messageKind: broadcast.messageKind,
      mediaUrl: broadcast.messageKind === 'text' || hasMediaFileIds ? '' : broadcast.mediaUrl.trim(),
      mediaFileIds,
      messageText: broadcast.messageText.trim()
    };
    const data = await apiJson(props.apiBase, '/admin/broadcasts/send', {
      method: 'POST',
      headers,
      body: payloadBody
    });

    const campaignId = Number(data?.campaign_id || 0);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      throw new Error('bad_campaign_id');
    }

    sendInfo.value = `Queued campaign #${campaignId} for ${fmt(data?.total_recipients || 0)} users.`;
    broadcastConfirm.value = '';
    await loadCampaignStatus(campaignId);
    startCampaignPolling(campaignId);
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    sendError.value = `Send failed: ${msg}`;
  } finally {
    sendingBroadcast.value = false;
  }
}

async function refreshAnalytics() {
  if (!canFetch.value) return;
  loading.value = true;
  errorText.value = '';
  try {
    const q = query();
    const headers = adminHeaders();
    const [
      summary,
      botStatsData,
      newUsers,
      newPaid,
      actionEvents,
      actionTotals,
      activeUsers,
      activeUsersByBot,
      inactiveUsers,
      usageSeconds,
      byHour,
      byHourToday,
      payloads
    ] = await Promise.all([
      apiJson(props.apiBase, '/admin/metrics/summary', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/bot-stats', { headers }),
      apiJson(props.apiBase, '/admin/metrics/new-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/new-paid-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/actions-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/action-totals', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-day-by-bot', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/inactive-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/usage-seconds-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-hour', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-hour-today', { query: { payload: q.payload }, headers }),
      apiJson(props.apiBase, '/admin/metrics/acquisition-payloads', { query: q, headers })
    ]);

    totals.value = summary?.totals || totals.value;
    botStats.value = Array.isArray(botStatsData?.bots) ? botStatsData.bots : [];
    newUsersSeries.value = Array.isArray(newUsers?.series) ? newUsers.series : [];
    newPaidSeries.value = Array.isArray(newPaid?.series) ? newPaid.series : [];
    actionEventsSeries.value = Array.isArray(actionEvents?.series) ? actionEvents.series : [];
    actionTotalsSeries.value = Array.isArray(actionTotals?.series)
      ? actionTotals.series.map((row) => ({
          day: actionLabel(row?.action),
          count: Number(row?.count || 0)
        }))
      : [];
    activeUsersSeries.value = Array.isArray(activeUsers?.series) ? activeUsers.series : [];
    inactiveUsersSeries.value = Array.isArray(inactiveUsers?.series) ? inactiveUsers.series : [];
    usageSecondsSeries.value = Array.isArray(usageSeconds?.series) ? usageSeconds.series : [];
    activeUsersByHourSeries.value = Array.isArray(byHour?.series) ? byHour.series : [];
    activeUsersByHourTodaySeries.value = Array.isArray(byHourToday?.series) ? byHourToday.series : [];
    payloadOptions.value = Array.isArray(payloads?.payloads) ? payloads.payloads : [];
    // Users list is loaded in the Users tab (separate request).
    
    // Transform bot-specific data
    const byBotRawRows = Array.isArray(activeUsersByBot?.series) ? activeUsersByBot.series : [];
    const { chartData: byBotData, seriesConfig: byBotConfig } = transformByBotData(byBotRawRows);
    activeUsersByBotSeries.value = byBotData;
    activeUsersByBotSeriesConfig.value = byBotConfig;
    
    lastUpdated.value = isoStampNow();
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    errorText.value = `Failed to load: ${msg}`;
  } finally {
    loading.value = false;
  }
}

async function refreshUsersPage({ resetOffset = false } = {}) {
  if (!canFetch.value) return;
  if (resetOffset) usersOffset.value = 0;
  usersLoading.value = true;
  usersError.value = '';
  try {
    const headers = adminHeaders();
    const q = query();
    const [usersRes, payloadsRes] = await Promise.allSettled([
      apiJson(props.apiBase, '/admin/users', {
        query: {
          ...q,
          limit: usersLimit.value,
          offset: usersOffset.value,
          sort_key: usersSort.key,
          sort_dir: usersSort.dir
        },
        headers
      }),
      apiJson(props.apiBase, '/admin/metrics/acquisition-payloads', { query: q, headers })
    ]);

    if (usersRes.status !== 'fulfilled') throw usersRes.reason;
    const data = usersRes.value;
    usersRows.value = Array.isArray(data?.items) ? data.items : [];
    usersTotal.value = Number.isFinite(Number(data?.total)) ? Number(data.total) : 0;
    usersUpdatedAt.value = isoStampNow();

    if (payloadsRes.status === 'fulfilled') {
      payloadOptions.value = Array.isArray(payloadsRes.value?.payloads) ? payloadsRes.value.payloads : payloadOptions.value;
    }
  } catch (err) {
    console.error(err);
    usersRows.value = [];
    usersTotal.value = 0;
    usersUpdatedAt.value = '';
    const msg = err?.payload?.error || err?.message || 'request_failed';
    usersError.value = `Failed to load users: ${msg}`;
  } finally {
    usersLoading.value = false;
  }
}

async function refreshFeedback({ resetOffset = false } = {}) {
  if (resetOffset) feedbackOffset.value = 0;
  if (!canFetchFeedback.value) return;

  feedbackLoading.value = true;
  feedbackError.value = '';
  clearFeedbackReplyState();
  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/feedbacks', {
      query: feedbackQuery(),
      headers
    });
    feedbackThreads.value = Array.isArray(data?.items) ? data.items : [];
    const nextTotal = Number(data?.total || 0);
    feedbackTotal.value = Number.isFinite(nextTotal) ? nextTotal : 0;
    feedbackUpdatedAt.value = isoStampNow();
  } catch (err) {
    console.error(err);
    feedbackThreads.value = [];
    feedbackTotal.value = 0;
    feedbackUpdatedAt.value = '';
    const msg = err?.payload?.error || err?.message || 'request_failed';
    feedbackError.value = `Failed to load feedback: ${msg}`;
  } finally {
    feedbackLoading.value = false;
  }
}

function feedbackNextPage() {
  if (!feedbackHasNext.value || feedbackLoading.value) return;
  feedbackOffset.value += feedbackLimit;
  refreshFeedback();
}

function feedbackPrevPage() {
  if (feedbackLoading.value) return;
  feedbackOffset.value = Math.max(0, feedbackOffset.value - feedbackLimit);
  refreshFeedback();
}

function resetRange() {
  rangePreset.value = 'last_30_days';
  const r = rangeForPreset('last_30_days');
  fromDate.value = r.from;
  toDate.value = r.to;
}

function applyRangePreset(preset) {
  rangePreset.value = preset;
  const r = rangeForPreset(preset);
  fromDate.value = r.from;
  toDate.value = r.to;
}

function resetFeedbackRange() {
  const r = defaultRange();
  feedbackFromDate.value = r.from;
  feedbackToDate.value = r.to;
}

function clearPassword() {
  password.value = '';
  errorText.value = '';
  previewError.value = '';
  sendError.value = '';
  sendInfo.value = '';
  clearBroadcastMedia();
  broadcastPreview.count = 0;
  broadcastPreview.sample = [];
  previewUpdatedAt.value = '';
  campaignState.value = null;
  stopCampaignPolling();
  feedbackThreads.value = [];
  feedbackTotal.value = 0;
  feedbackOffset.value = 0;
  feedbackError.value = '';
  feedbackUpdatedAt.value = '';
  clearFeedbackReplyState();
  usersRows.value = [];
  usersTotal.value = 0;
  usersOffset.value = 0;
  usersError.value = '';
  usersUpdatedAt.value = '';
}

function usersNextPage() {
  if (!usersHasNext.value || usersLoading.value) return;
  usersOffset.value += usersLimit.value;
  refreshUsersPage();
}

function usersPrevPage() {
  if (usersLoading.value) return;
  usersOffset.value = Math.max(0, usersOffset.value - usersLimit.value);
  refreshUsersPage();
}

onMounted(() => {
  // No auto-fetch until password is provided.
});

watch(
  () => [
    password.value,
    broadcast.username,
    broadcast.planFree,
    broadcast.planPro,
    broadcast.lastActivityMode,
    broadcast.lastActivityDays,
    broadcast.usageMode,
    broadcast.usagePercent,
    broadcast.botKeys.slice().sort().join(',')
  ],
  () => {
    if (!password.value) {
      previewError.value = '';
      broadcastPreview.count = 0;
      broadcastPreview.sample = [];
      previewUpdatedAt.value = '';
      return;
    }
    scheduleBroadcastPreview();
  },
  { deep: true }
);

watch(
  () => broadcast.messageKind,
  (kind) => {
    if (kind === 'text') {
      clearBroadcastMedia();
      broadcast.messageText = broadcast.messageText;
      return;
    }
    mediaUploadError.value = '';
    mediaUploadInfo.value = '';
    broadcast.mediaFileIds = {};
  }
);

watch(
  () => activeTab.value,
  (tab) => {
    if (tab === 'messaging' && password.value && botStats.value.length === 0) {
      refreshBotStats();
    }
    if (tab === 'feedback' && password.value && feedbackThreads.value.length === 0) {
      feedbackOffset.value = 0;
      refreshFeedback();
    }
    if (tab === 'users' && password.value && usersRows.value.length === 0) {
      refreshUsersPage({ resetOffset: true });
    }
  }
);

watch(
  () => botStats.value.map((bot) => bot.bot_key).join(','),
  () => {
    if (broadcast.botKeys.length === 0) return;
    const allowed = new Set(botStats.value.map((bot) => bot.bot_key));
    const next = broadcast.botKeys.filter((botKey) => allowed.has(botKey));
    if (next.length !== broadcast.botKeys.length) {
      broadcast.botKeys = next;
    }
  }
);

onBeforeUnmount(() => {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  stopCampaignPolling();
});
</script>

<style scoped>
.shell {
  width: min(1420px, 100%);
  padding: 44px 22px 76px;
  display: grid;
  gap: 18px;
  position: relative;
  isolation: isolate;
  align-self: flex-start;
  align-content: start;
}

.shell::before {
  content: '';
  position: absolute;
  inset: -160px -80px -120px;
  z-index: -1;
  background:
    radial-gradient(420px 280px at 18% 6%, rgba(59, 130, 246, 0.18), transparent 60%),
    radial-gradient(420px 320px at 85% 22%, rgba(245, 158, 11, 0.14), transparent 62%),
    radial-gradient(520px 360px at 30% 82%, rgba(31, 107, 99, 0.14), transparent 65%),
    linear-gradient(180deg, rgba(248, 250, 252, 0.98), rgba(248, 250, 252, 0.72));
}

.hero {
  display: grid;
  gap: 10px;
}

.kicker {
  text-transform: uppercase;
  letter-spacing: 0.26em;
  font-size: 11px;
  color: var(--accent-2);
}

h1 {
  font-family: var(--font-display);
  margin: 0;
  font-size: clamp(30px, 5vw, 52px);
  letter-spacing: -0.02em;
  line-height: 1;
}

.sub {
  margin: 0;
  max-width: 70ch;
  color: var(--muted);
  font-size: 15px;
  line-height: 1.6;
}

.card {
  border: 1px solid var(--stroke);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 18px 40px var(--shadow);
  padding: 14px;
  display: grid;
  gap: 12px;
}

.access-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}

.access-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(246, 241, 232, 0.55);
  padding: 7px 10px;
  font-size: 12px;
  color: rgba(30, 26, 22, 0.78);
  font-weight: 750;
  white-space: nowrap;
}

.status-pill.ok {
  border-color: rgba(31, 107, 99, 0.28);
  background: rgba(31, 107, 99, 0.10);
  color: rgba(31, 107, 99, 0.92);
}

.status-pill.subtle {
  opacity: 0.85;
}

.tabs {
  position: sticky;
  top: 14px;
  z-index: 8;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 6px;
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.58);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  align-items: center;
}

.tab-btn {
  border: 1px solid transparent;
  background: transparent;
  border-radius: 999px;
  padding: 9px 14px;
  cursor: pointer;
  font-weight: 650;
  letter-spacing: 0.01em;
  transition: background 160ms ease, border-color 160ms ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-inline-size: 120px;
  white-space: nowrap;
}

.tab-btn.active {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.22);
}

.panel {
  gap: 12px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  flex-wrap: wrap;
}

.panel-kicker {
  text-transform: uppercase;
  letter-spacing: 0.22em;
  font-size: 10px;
  color: rgba(30, 26, 22, 0.55);
}

.panel-title {
  margin: 2px 0 0;
  font-size: 22px;
  line-height: 1.2;
}

.panel-sub {
  margin: 6px 0 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.55;
}

.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: flex-end;
}

.panel-body {
  display: grid;
  gap: 12px;
}

.callout {
  border-radius: 16px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(246, 241, 232, 0.40);
  padding: 10px 12px;
  font-size: 13px;
  color: rgba(30, 26, 22, 0.78);
}

.callout.error {
  border-color: rgba(174, 43, 40, 0.22);
  background: rgba(174, 43, 40, 0.08);
  color: rgba(174, 43, 40, 0.92);
}

.row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
}

.field {
  display: grid;
  gap: 6px;
  min-width: 210px;
}

.field span {
  font-size: 12px;
  color: var(--muted);
}

.field input[type='text'],
.field input[type='password'],
.field input[type='date'],
.field input[type='number'],
.field select,
.field textarea {
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.16);
  background: rgba(246, 241, 232, 0.6);
  padding: 0 12px;
  font: inherit;
  color: var(--ink);
  outline: none;
}

.field input[type='text'],
.field input[type='password'],
.field input[type='date'],
.field input[type='number'],
.field select {
  height: 42px;
}

.field textarea {
  min-height: 120px;
  padding: 10px 12px;
  resize: vertical;
}

.field select {
  appearance: none;
}

.field input[type='text']:focus,
.field input[type='password']:focus,
.field input[type='date']:focus,
.field input[type='number']:focus,
.field select:focus,
.field textarea:focus {
  border-color: rgba(31, 107, 99, 0.55);
  box-shadow: 0 0 0 4px rgba(31, 107, 99, 0.15);
}

.grow {
  flex: 1;
  min-width: 280px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.btn {
  border: 1px solid var(--stroke);
  background: rgba(255, 255, 255, 0.62);
  border-radius: 999px;
  padding: 10px 14px;
  cursor: pointer;
  font-weight: 650;
  letter-spacing: 0.01em;
  box-shadow: 0 12px 26px rgba(30, 26, 22, 0.14);
  transition: transform 120ms ease, box-shadow 120ms ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-inline-size: 112px;
  white-space: nowrap;
}

.btn:active {
  transform: translateY(1px);
  box-shadow: 0 9px 18px rgba(30, 26, 22, 0.12);
}

.btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
  transform: none;
}

.primary {
  background: rgba(199, 90, 36, 0.16);
  border-color: rgba(199, 90, 36, 0.28);
}

.danger {
  background: rgba(174, 43, 40, 0.12);
  border-color: rgba(174, 43, 40, 0.22);
}

.hint {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
}

.hint code {
  font-size: 12px;
}

.error {
  margin: 0;
  color: rgba(174, 43, 40, 0.9);
  font-size: 13px;
}

.kpi-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.kpi {
  border: 1px solid rgba(30, 26, 22, 0.10);
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.62);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  box-shadow: 0 18px 40px rgba(20, 18, 16, 0.12);
  padding: 14px 14px 12px;
  display: grid;
  gap: 6px;
}

.kpi-label {
  color: var(--muted);
  font-size: 12px;
}

.kpi-value {
  font-family: var(--font-display);
  font-size: 34px;
  line-height: 1;
  letter-spacing: -0.02em;
}

.kpi-value-sub {
  font-size: 19px;
  color: var(--muted);
  font-weight: 600;
}

.kpi-meta {
  color: var(--muted);
  font-size: 12px;
}

.charts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 12px;
}

.compact {
  margin-top: 6px;
}

.counter-chip {
  min-width: 180px;
  border-radius: 16px;
  border: 1px solid rgba(31, 107, 99, 0.22);
  background: rgba(31, 107, 99, 0.08);
  padding: 10px 12px;
  display: grid;
  gap: 4px;
}

.counter-chip.warn {
  border-color: rgba(174, 43, 40, 0.22);
  background: rgba(174, 43, 40, 0.08);
}

.counter-chip-label {
  font-size: 12px;
  color: var(--muted);
}

.counter-chip-value {
  font-family: var(--font-display);
  font-size: 32px;
  line-height: 1;
}

.counter-chip-meta {
  font-size: 11px;
  color: var(--muted);
}

.broadcast-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  align-items: start;
}

.broadcast-pane {
  border-radius: 18px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.54);
  padding: 12px;
  display: grid;
  gap: 12px;
}

.pane-title {
  font-weight: 800;
  letter-spacing: -0.01em;
}

.sample-card {
  border-top: 1px solid rgba(30, 26, 22, 0.10);
  padding-top: 12px;
  display: grid;
  gap: 8px;
}

.sample-title {
  font-size: 12px;
  color: var(--muted);
}

.sample-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(30, 26, 22, 0.08);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.62);
}

.sample-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.sample-table th,
.sample-table td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(30, 26, 22, 0.08);
  text-align: left;
  white-space: nowrap;
}

.sample-table th {
  position: sticky;
  top: 0;
  background: rgba(246, 241, 232, 0.85);
  color: rgba(30, 26, 22, 0.68);
  font-weight: 750;
}

.sample-table tbody tr:nth-child(even) td {
  background: rgba(246, 241, 232, 0.14);
}

.sample-table tbody tr:hover td {
  background: rgba(255, 255, 255, 0.70);
}

.plan-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 42px;
  align-items: center;
}

.pill {
  border: 1px solid rgba(30, 26, 22, 0.14);
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.62);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
  transition: all 150ms ease;
}

.pill:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(31, 107, 99, 0.3);
}

.pill.active {
  background: rgba(31, 107, 99, 0.12);
  border-color: rgba(31, 107, 99, 0.4);
  font-weight: 600;
}

.pill input {
  height: 14px;
  width: 14px;
  margin: 0;
  cursor: pointer;
}

.bot-badge {
  background: rgba(99, 102, 241, 0.1);
  color: rgb(99, 102, 241);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  font-family: ui-monospace, 'SF Mono', 'Cascadia Code', 'Roboto Mono', monospace;
}

.campaign-state {
  border-top: 1px solid rgba(30, 26, 22, 0.1);
  padding-top: 10px;
  display: grid;
  gap: 6px;
}

.campaign-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.chip {
  border-radius: 999px;
  border: 1px solid rgba(30, 26, 22, 0.14);
  padding: 2px 8px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  background: rgba(246, 241, 232, 0.55);
}

.campaign-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

.feedback-list {
  display: grid;
  gap: 10px;
}

.feedback-item {
  border: 1px solid rgba(30, 26, 22, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.64);
  padding: 10px 12px;
  display: grid;
  gap: 8px;
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.feedback-item:hover {
  background: rgba(255, 255, 255, 0.74);
  border-color: rgba(59, 130, 246, 0.22);
  box-shadow: 0 18px 44px rgba(20, 18, 16, 0.12);
}

.feedback-item-head {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}

.feedback-meta {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
}

.feedback-thread-head {
  align-items: start;
}

.feedback-thread-title,
.feedback-thread-times {
  display: grid;
  gap: 6px;
}

.feedback-thread-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
}

.feedback-user {
  font-weight: 650;
  color: var(--ink);
}

.feedback-thread-preview {
  border-left: 3px solid rgba(31, 107, 99, 0.22);
  padding-left: 10px;
  color: rgba(30, 26, 22, 0.82);
  font-size: 13px;
}

.feedback-thread-messages {
  display: grid;
  gap: 10px;
}

.feedback-message {
  display: grid;
  gap: 6px;
  padding: 10px 12px;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(246, 241, 232, 0.42);
}

.feedback-message.admin {
  background: rgba(199, 90, 36, 0.09);
  border-color: rgba(199, 90, 36, 0.18);
}

.feedback-message.user {
  background: rgba(255, 255, 255, 0.76);
}

.feedback-message-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--muted);
}

.chip.admin {
  background: rgba(199, 90, 36, 0.13);
  border-color: rgba(199, 90, 36, 0.24);
}

.chip.archived {
  background: rgba(87, 60, 127, 0.12);
  border-color: rgba(87, 60, 127, 0.22);
  color: rgba(87, 60, 127, 0.92);
}

.feedback-inline-action {
  border: none;
  background: transparent;
  padding: 0;
  color: var(--accent-2);
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
}

.feedback-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font: inherit;
  color: var(--ink);
}

.feedback-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
}

.feedback-actions .btn,
.feedback-reply .btn {
  min-inline-size: 0;
  padding: 8px 12px;
  box-shadow: 0 10px 20px rgba(30, 26, 22, 0.12);
  font-size: 12px;
}

.feedback-reply {
  border-top: 1px solid rgba(30, 26, 22, 0.08);
  padding-top: 8px;
  display: grid;
  gap: 8px;
}

.feedback-reply-target {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 10px;
  font-size: 12px;
  color: var(--muted);
}

.feedback-reply .field {
  min-width: 0;
}

.feedback-reply .field textarea {
  min-height: 88px;
}

.feedback-reply-foot {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.feedback-delete {
  border: 1px solid rgba(174, 43, 40, 0.14);
  background: rgba(174, 43, 40, 0.05);
  border-radius: 12px;
  padding: 10px 12px;
  display: grid;
  gap: 8px;
}

.feedback-delete-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.feedback-pager {
  display: flex;
  gap: 10px;
}

.users-table-card {
  gap: 10px;
}

.users-head {
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 12px;
  flex-wrap: wrap;
}

.users-head h2 {
  margin: 0;
  font-size: 22px;
  line-height: 1.2;
}

.users-meta {
  display: flex;
  gap: 10px;
  font-size: 12px;
  color: var(--muted);
  flex-wrap: wrap;
}

.users-limit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.users-limit select {
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(255, 255, 255, 0.65);
  border-radius: 10px;
  padding: 4px 8px;
  font: inherit;
  color: var(--ink);
}

.users-table-wrap {
  overflow-x: auto;
  border: 1px solid rgba(30, 26, 22, 0.1);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.64);
}

.users-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.users-table th,
.users-table td {
  padding: 9px 10px;
  border-bottom: 1px solid rgba(30, 26, 22, 0.08);
  text-align: left;
  white-space: nowrap;
}

.users-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  color: var(--muted);
  font-weight: 650;
  background: rgba(246, 241, 232, 0.6);
}

.users-table tbody tr:nth-child(even) td {
  background: rgba(246, 241, 232, 0.16);
}

.users-table tbody tr:hover td {
  background: rgba(255, 255, 255, 0.66);
}

.users-table tbody tr:last-child td {
  border-bottom: none;
}

@media (max-width: 820px) {
  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .charts-grid {
    grid-template-columns: 1fr;
  }

  .tab-btn {
    min-inline-size: 0;
  }

  .btn {
    min-inline-size: 0;
  }
}

@media (max-width: 980px) {
  .broadcast-layout {
    grid-template-columns: 1fr;
  }
}

.foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  margin-top: 8px;
}

.link {
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: var(--accent-2);
  font-weight: 650;
}

.stamp {
  opacity: 0.9;
}

.bot-stats-head {
  display: grid;
  gap: 6px;
}

.bot-table-wrap {
  margin-top: 10px;
  overflow: auto;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(246, 241, 232, 0.35);
}

.bot-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 640px;
}

.bot-table thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgba(246, 241, 232, 0.9);
  border-bottom: 1px solid rgba(30, 26, 22, 0.10);
  padding: 10px 10px;
  text-align: left;
  font-size: 12px;
  color: rgba(30, 26, 22, 0.78);
  white-space: nowrap;
}

.bot-table th.num,
.bot-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.bot-table tbody td {
  border-top: 1px solid rgba(30, 26, 22, 0.08);
  padding: 10px 10px;
  font-size: 13px;
  color: rgba(30, 26, 22, 0.85);
  white-space: nowrap;
}

.bot-table tbody tr:nth-child(even) td {
  background: rgba(255, 255, 255, 0.32);
}

.bot-table tbody tr:hover td {
  background: rgba(255, 255, 255, 0.55);
}

.sort {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  cursor: pointer;
  color: inherit;
  font-weight: 700;
}

.sort-ind {
  display: inline-block;
  min-width: 10px;
  opacity: 0.65;
}

.bot {
  display: grid;
  gap: 2px;
}

.bot-key {
  font-family: var(--font-display);
  font-weight: 760;
  letter-spacing: 0.01em;
  color: var(--ink);
}

.bot-meta {
  font-size: 12px;
  color: var(--muted);
}
</style>
