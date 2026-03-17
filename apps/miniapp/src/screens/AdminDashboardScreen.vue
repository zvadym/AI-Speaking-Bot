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
          <button class="btn danger" type="button" :disabled="loading || feedbackLoading || usersLoading || previewLoading || billingLoading || Boolean(billingMutationBusyId)" @click="clearPassword">
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
      <button class="tab-btn" :class="{ active: activeTab === 'billing' }" type="button" role="tab" @click="activeTab = 'billing'">
        Billing
      </button>
      <button class="tab-btn" :class="{ active: activeTab === 'topics' }" type="button" role="tab" @click="activeTab = 'topics'">
        Topics
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
            <p class="panel-sub">UTC charts with live preset windows. Custom mode stays inclusive for both From and To dates.</p>
          </div>
          <div class="panel-actions">
            <button class="btn primary" type="button" :disabled="!canFetch || loading" @click="refreshAnalytics">
              {{ loading ? 'Loading…' : 'Refresh' }}
            </button>
          </div>
        </header>

        <div class="panel-body">
          <section class="filter-panel" aria-label="Analytics filters">
            <div class="filter-topline">
              <div class="field grow">
                <span>Time window</span>
                <div class="range-toolbar">
                  <button
                    v-for="option in rangePresetOptions"
                    :key="option.value"
                    class="preset-chip"
                    type="button"
                    :class="{ active: rangePreset === option.value }"
                    :disabled="loading"
                    @click="selectRangePreset(option.value)"
                  >
                    {{ option.label }}
                  </button>
                  <button
                    class="preset-chip"
                    type="button"
                    :class="{ active: isCustomRange }"
                    :disabled="loading"
                    @click="selectCustomRange"
                  >
                    Custom
                  </button>
                </div>
              </div>
            </div>

            <div class="range-summary-card" :class="{ custom: isCustomRange }">
              <div class="range-summary-copy">
                <span class="range-summary-kicker">{{ isCustomRange ? 'Custom range' : 'Live preset' }}</span>
                <strong class="range-summary-title">{{ activeRangeLabel }}</strong>
                <span class="range-summary-text">{{ activeRangeText }}</span>
              </div>
              <div class="range-summary-window">
                <span class="range-summary-window-label">Resolved UTC window</span>
                <strong>{{ activeRangeWindow }}</strong>
              </div>
            </div>

            <div v-if="isCustomRange" class="row range-custom-row">
              <label class="field">
                <span>From (UTC)</span>
                <input v-model="fromDate" type="date" />
              </label>

              <label class="field">
                <span>To (UTC, inclusive)</span>
                <input v-model="toDate" type="date" />
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
                  placeholder="All payloads"
                  list="payloads"
                />
                <datalist id="payloads">
                  <option v-for="p in payloadOptions" :key="p.payload" :value="p.payload" />
                </datalist>
              </label>
            </div>

            <div class="row exclude-users-row">
              <label class="field grow">
                <span>Exclude users (local)</span>
                <input
                  v-model.trim="excludeSearch"
                  type="text"
                  inputmode="text"
                  autocomplete="off"
                  placeholder="@username or chat_id"
                  :disabled="loading"
                  @keydown.enter.prevent="addExcludedFromSearch"
                />
                <small class="hint">Affects analytics charts and totals on this device only.</small>
              </label>

              <div class="actions">
                <button class="btn" type="button" :disabled="loading || excludedUsers.length === 0" @click="clearExcludedUsers">
                  Clear
                </button>
              </div>
            </div>

            <div v-if="excludedUsers.length" class="chip-row">
              <button
                v-for="u in excludedUsers"
                :key="u.chat_id"
                class="exclude-chip"
                type="button"
                :disabled="loading"
                @click="removeExcludedUser(u.chat_id)"
              >
                <span>{{ excludedUserLabel(u) }}</span>
                <span aria-hidden="true" class="exclude-chip-x">×</span>
              </button>
            </div>

            <div v-if="excludeLookupError" class="hint error">
              {{ excludeLookupError }}
            </div>

            <div v-if="excludeSuggestions.length" class="exclude-suggestions">
              <button
                v-for="u in excludeSuggestions"
                :key="u.chat_id"
                class="exclude-suggestion"
                type="button"
                :disabled="loading"
                @click="addExcludedUser(u)"
              >
                <div class="exclude-suggestion-main">
                  <strong>{{ excludedUserLabel(u) }}</strong>
                  <span class="exclude-suggestion-meta"><code>{{ u.chat_id }}</code></span>
                </div>
                <span class="exclude-suggestion-action">Add</span>
              </button>
            </div>
          </section>

          <div class="row">
            <label class="field grow">
              <span>Current query</span>
              <div class="query-chip-row">
                <span class="query-chip">{{ activeRangeWindow }}</span>
                <span v-if="payload.trim()" class="query-chip subtle">Payload: {{ payload.trim() }}</span>
                <span v-if="excludedUsers.length" class="query-chip subtle">Excluded: {{ fmt(excludedUsers.length) }}</span>
              </div>
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

      <section class="card panel free-users-panel">
        <header class="panel-head">
          <div>
            <div class="panel-kicker">Free users</div>
            <h2 class="panel-title">Usage distribution</h2>
            <p class="panel-sub">{{ freeUsersPanelSubtitle }}</p>
          </div>
          <div class="panel-actions notification-toolbar">
            <label class="field notification-filter">
              <span>Bot scope</span>
              <select v-model="freeUsersBotFilter" :disabled="loading || freeUsersLoading">
                <option value="all">All bots</option>
                <option
                  v-for="bot in botScopeOptions"
                  :key="bot.bot_key"
                  :value="bot.bot_key"
                >
                  {{ bot.bot_key }}
                </option>
              </select>
            </label>
          </div>
        </header>

        <div class="panel-body free-users-body">
          <p v-if="freeUsersLoading && !loading" class="hint">Updating free-user usage scope…</p>
          <p v-if="freeUsersError" class="error">{{ freeUsersError }}</p>

          <section class="kpi-grid">
            <article class="kpi">
              <div class="kpi-label">Current free users</div>
              <div class="kpi-value">{{ fmt(freeUserTotals.free_users_all_time) }}</div>
              <div class="kpi-meta">Engaged in range: {{ fmt(freeUserTotals.engaged_free_users_in_range) }}</div>
            </article>
            <article class="kpi">
              <div class="kpi-label">Free users with voice</div>
              <div class="kpi-value">{{ fmt(freeUserTotals.free_users_with_voice_in_range) }}</div>
              <div class="kpi-meta">Any in/out voice usage in selected range</div>
            </article>
            <article class="kpi">
              <div class="kpi-label">Voice used (in+out)</div>
              <div class="kpi-value">{{ formatDurationCompact(totalFreeVoiceSeconds) }}</div>
              <div class="kpi-meta">In: {{ formatDurationCompact(freeUserTotals.in_seconds) }} · Out: {{ formatDurationCompact(freeUserTotals.out_seconds) }}</div>
            </article>
            <article class="kpi">
              <div class="kpi-label">Messages sent</div>
              <div class="kpi-value">{{ fmt(freeUserTotals.sent_messages) }}</div>
              <div class="kpi-meta">Free users with messages: {{ fmt(freeUserTotals.free_users_with_messages_in_range) }} · Replies: {{ fmt(freeUserTotals.assistant_messages) }}</div>
            </article>
          </section>

          <section class="charts-grid">
            <AdminChart
              title="Free users by voice seconds"
              subtitle="Per-user total voice usage (in + out) in selected range"
              kind="bar"
              x-labels="all"
              :data="freeUsersUsageBuckets"
              :series="[{ key: 'users', label: 'Free users', color: 'rgba(46, 88, 142, 0.88)' }]"
            />

            <AdminChart
              title="Free users by messages sent"
              subtitle="User-originated messages per free user in selected range"
              kind="bar"
              x-labels="all"
              :data="freeUsersMessageBuckets"
              :series="[{ key: 'users', label: 'Free users', color: 'rgba(199, 90, 36, 0.88)' }]"
            />
          </section>
        </div>
      </section>

      <section class="charts-grid">
        <AdminChart
          title="Active users by hour"
          subtitle="UTC hour-of-day distribution for selected range with today layered on top"
          kind="bar"
          :stacked="false"
          x-labels="all"
          :data="activeUsersByHourCombinedSeries"
          :series="[
            { key: 'selected_range', label: 'Selected range', color: 'rgba(31, 107, 99, 0.42)', grouped: false, maxBarThickness: 30, barPercentage: 0.88, categoryPercentage: 0.92, order: 1 },
            { key: 'today', label: 'Today', color: 'rgba(199, 90, 36, 0.88)', grouped: false, maxBarThickness: 16, barPercentage: 0.52, categoryPercentage: 0.92, order: 2 }
          ]"
        />

        <AdminChart
          title="Voice usage seconds by hour today"
          subtitle="UTC, today only. Voice seconds on left axis, messages on right axis"
          kind="line"
          x-labels="all"
          :data="activeUsersByHourTodaySeries"
          :series="[
            { key: 'in_seconds', label: 'In', color: 'rgba(31, 107, 99, 0.9)', type: 'line' },
            { key: 'out_seconds', label: 'Out', color: 'rgba(46, 88, 142, 0.9)', type: 'line' },
            { key: 'message_count', label: 'Messages', color: 'rgba(199, 90, 36, 0.58)', type: 'bar', yAxisId: 'y1' }
          ]"
        />

        <AdminChart
          title="User streaks"
          subtitle="Longest consecutive active-day streak per user in selected UTC range"
          kind="bar"
          x-labels="all"
          :data="userStreakSeries"
          :series="[
            { key: 'users', label: 'Users', color: 'rgba(103, 78, 167, 0.88)' }
          ]"
        />
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

      <section class="card panel">
        <header class="panel-head">
          <div>
            <div class="panel-kicker">Notifications</div>
            <h2 class="panel-title">Sent by day</h2>
            <p class="panel-sub">{{ notificationChartSubtitle }}</p>
          </div>
          <div class="panel-actions notification-toolbar">
            <label class="field notification-filter">
              <span>Bot scope</span>
              <select v-model="notificationBotFilter">
                <option value="all">All bots</option>
                <option
                  v-for="bot in botScopeOptions"
                  :key="bot.bot_key"
                  :value="bot.bot_key"
                >
                  {{ bot.bot_key }}
                </option>
              </select>
            </label>
          </div>
        </header>

        <div class="panel-body notification-panel-body">
          <div class="notification-overview">
            <article class="notification-overview-item">
              <span class="notification-overview-label">Bot scope</span>
              <strong class="notification-overview-value">{{ notificationBotFilterLabel }}</strong>
            </article>
            <article class="notification-overview-item">
              <span class="notification-overview-label">Recipient sends</span>
              <strong class="notification-overview-value">{{ fmt(notificationTotalSent) }}</strong>
            </article>
            <article class="notification-overview-item">
              <span class="notification-overview-label">Active types</span>
              <strong class="notification-overview-value">{{ fmt(notificationSeriesConfig.length) }}</strong>
            </article>
          </div>

          <AdminChart
            title="Notifications sent by day"
            subtitle="Recipient-level sends stacked by notification type"
            kind="bar"
            x-labels="all"
            :data="notificationChartSeries"
            :series="notificationSeriesConfig"
          />
        </div>
      </section>

      <section class="card panel">
        <header class="panel-head">
          <div>
            <div class="panel-kicker">Reply keyboard</div>
            <h2 class="panel-title">Usage</h2>
            <p class="panel-sub">Raw taps on the persistent Telegram reply keyboard. Slash commands are excluded.</p>
          </div>
        </header>

        <div class="panel-body notification-panel-body">
          <div class="notification-overview">
            <article class="notification-overview-item">
              <span class="notification-overview-label">Total clicks</span>
              <strong class="notification-overview-value">{{ fmt(replyKeyboardSummary.total_clicks) }}</strong>
            </article>
            <article class="notification-overview-item">
              <span class="notification-overview-label">Unique users</span>
              <strong class="notification-overview-value">{{ fmt(replyKeyboardSummary.unique_users) }}</strong>
            </article>
            <article class="notification-overview-item">
              <span class="notification-overview-label">Top button</span>
              <strong class="notification-overview-value">{{ replyKeyboardTopActionLabel }}</strong>
            </article>
          </div>

          <AdminChart
            title="Reply keyboard clicks by day"
            subtitle="Raw click count by button type"
            kind="bar"
            x-labels="all"
            :data="replyKeyboardClicksSeries"
            :series="replyKeyboardSeriesConfig"
          />
        </div>
      </section>

      <section class="charts-grid">
        <AdminChart
          title="New users by day by bot"
          subtitle="New users split by first associated bot"
          kind="bar"
          x-labels="all"
          :data="newUsersByBotSeries"
          :series="newUsersByBotSeriesConfig"
        />

        <AdminChart
          title="New paid users by day (first time)"
          subtitle="First-time plus/pro activations split by first associated bot"
          kind="bar"
          x-labels="all"
          :data="newPaidSeries"
          :series="newPaidSeriesConfig"
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
          title="Topic usage by day"
          subtitle="Distinct users engaging with pinned topics, split by topic"
          kind="bar"
          x-labels="all"
          :data="topicUsageSeries"
          :series="topicUsageSeriesConfig"
        />

        <AdminChart
          title="Onboarding funnel"
          subtitle="Each stage is the share of Started users in that window. Hover for percent and user count."
          kind="bar"
          x-labels="all"
          :stacked="false"
          :axis-formats="{ y: 'percent' }"
          :data="actionFunnelComparisonSeries"
          :series="actionFunnelComparisonChartSeries"
        />

        <AdminChart
          title="Active users by day"
          subtitle="Daily active users in UTC split into first-day and returning users, with total users present in the database that day"
          kind="bar"
          x-labels="all"
          :data="activeUsersChartSeries"
          :series="[
            { key: 'new_users', label: 'New users', color: 'rgba(199, 90, 36, 0.88)' },
            { key: 'returned_users', label: 'Returned users', color: 'rgba(31, 107, 99, 0.78)' },
            { key: 'overall', label: 'Users overall', color: 'rgba(99, 74, 47, 0.94)', type: 'line', yAxisId: 'y1' }
          ]"
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
      </section>

      <section class="charts-grid">
        <AdminChart
          title="XP distribution"
          subtitle="Total XP per user (sum across bots). Buckets are inclusive."
          kind="bar"
          x-labels="all"
          :data="xpDistributionSeries"
          :series="[{ key: 'users', label: 'Users', color: 'rgba(103, 78, 167, 0.88)' }]"
        />

        <AdminChart
          title="Daily XP earned"
          subtitle="UTC. Total XP awarded per day (right axis: users earning XP)."
          kind="line"
          x-labels="all"
          :data="xpEarnedByDaySeries"
          :series="[
            { key: 'xp', label: 'XP', color: 'rgba(31, 107, 99, 0.9)', type: 'line' },
            { key: 'users', label: 'Users', color: 'rgba(199, 90, 36, 0.58)', type: 'bar', yAxisId: 'y1' }
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
            <p class="panel-sub">Server-side sorting and pagination with the same live UTC range model used in analytics.</p>
          </div>
          <div class="panel-actions">
            <button class="btn primary" type="button" :disabled="!canFetch || usersLoading" @click="refreshUsersPage({ resetOffset: true })">
              {{ usersLoading ? 'Loading…' : 'Refresh users' }}
            </button>
          </div>
        </header>

        <div class="panel-body">
          <section class="filter-panel" aria-label="User filters">
            <div class="filter-topline">
              <div class="field grow">
                <span>Time window</span>
                <div class="range-toolbar">
                  <button
                    v-for="option in rangePresetOptions"
                    :key="option.value"
                    class="preset-chip"
                    type="button"
                    :class="{ active: rangePreset === option.value }"
                    :disabled="usersLoading"
                    @click="selectRangePreset(option.value)"
                  >
                    {{ option.label }}
                  </button>
                  <button
                    class="preset-chip"
                    type="button"
                    :class="{ active: isCustomRange }"
                    :disabled="usersLoading"
                    @click="selectCustomRange"
                  >
                    Custom
                  </button>
                </div>
              </div>
            </div>

            <div class="range-summary-card" :class="{ custom: isCustomRange }">
              <div class="range-summary-copy">
                <span class="range-summary-kicker">{{ isCustomRange ? 'Custom range' : 'Live preset' }}</span>
                <strong class="range-summary-title">{{ activeRangeLabel }}</strong>
                <span class="range-summary-text">{{ activeRangeText }}</span>
              </div>
              <div class="range-summary-window">
                <span class="range-summary-window-label">Resolved UTC window</span>
                <strong>{{ activeRangeWindow }}</strong>
              </div>
            </div>

            <div v-if="isCustomRange" class="row range-custom-row">
              <label class="field">
                <span>From (UTC)</span>
                <input v-model="fromDate" type="date" />
              </label>

              <label class="field">
                <span>To (UTC, inclusive)</span>
                <input v-model="toDate" type="date" />
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
                  placeholder="All payloads"
                  list="payloads"
                />
                <datalist id="payloads">
                  <option v-for="p in payloadOptions" :key="p.payload" :value="p.payload" />
                </datalist>
              </label>
            </div>
          </section>

          <div class="row">
            <label class="field grow">
              <span>Current query</span>
              <div class="query-chip-row">
                <span class="query-chip">{{ activeRangeWindow }}</span>
                <span v-if="payload.trim()" class="query-chip subtle">Payload: {{ payload.trim() }}</span>
              </div>
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
        <p class="error" v-if="userDeleteError">{{ userDeleteError }}</p>
        <p class="hint" v-else-if="userDeleteInfo">{{ userDeleteInfo }}</p>

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
                <th>
                  <button class="sort" type="button" @click="toggleUsersSort('streak_days')">
                    Streak
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('streak_days') }}</span>
                  </button>
                </th>
                <th class="num">
                  <button class="sort" type="button" @click="toggleUsersSort('level')">
                    Level
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('level') }}</span>
                  </button>
                </th>
                <th class="num">
                  <button class="sort" type="button" @click="toggleUsersSort('xp_total')">
                    XP
                    <span class="sort-ind" aria-hidden="true">{{ usersSortIndicator('xp_total') }}</span>
                  </button>
                </th>
                <th class="actions">Actions</th>
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
                <td class="num">{{ fmt(row.streak_days || 0) }}</td>
                <td class="num">{{ fmt(row.level || 1) }}</td>
                <td class="num">{{ fmt(row.xp_total || 0) }}</td>
                <td class="actions">
                  <button class="btn danger users-delete-btn" type="button" :disabled="!password || usersLoading || Boolean(userDeleteBusyId)" @click="deleteUserCompletely(row)">
                    {{ userDeleteBusyId === String(row.chat_id) ? 'Deleting…' : 'Delete' }}
                  </button>
                </td>
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

    <template v-else-if="activeTab === 'messaging'">
    <section class="card panel">
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

            <label class="field">
              <span>Streak</span>
              <select v-model="broadcast.streakMode">
                <option value="any">Any</option>
                <option value="gte">At least X days</option>
                <option value="zero">No streak in range</option>
              </select>
            </label>

            <label class="field" v-if="broadcast.streakMode === 'gte'">
              <span>X days</span>
              <input v-model.number="broadcast.streakDays" type="number" min="1" max="3650" />
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

          <div class="row" v-if="broadcast.streakMode !== 'any'">
            <div class="field grow">
              <span>Streak range</span>
              <small class="hint">Uses the current UTC range from Analytics/Users: <code>{{ activeRangeWindow }}</code></small>
            </div>
          </div>

          <div class="row">
            <div class="field grow">
              <span>Bots</span>
              <small class="hint">Pick at least one bot. A single campaign can only target one base language.</small>
              <div v-if="botStats.length" class="broadcast-groups">
                <section
                  class="broadcast-group"
                  v-for="group in broadcastBotGroups"
                  :key="group.base_lang"
                  :class="{ locked: group.locked }"
                >
                  <div class="broadcast-group-head">
                    <strong>{{ group.label }}</strong>
                    <span class="hint">{{ fmt(group.bots.length) }} bot{{ group.bots.length === 1 ? '' : 's' }}</span>
                  </div>
                  <div class="plan-pills">
                    <label
                      class="pill"
                      v-for="bot in group.bots"
                      :key="bot.bot_key"
                      :class="{ active: selectedBroadcastBotKeys.includes(bot.bot_key), disabled: group.locked }"
                    >
                      <input
                        type="checkbox"
                        :checked="selectedBroadcastBotKeys.includes(bot.bot_key)"
                        :disabled="group.locked"
                        @change="toggleBroadcastBot(bot.bot_key, $event.target.checked)"
                      />
                      <span>{{ bot.bot_key }}</span>
                    </label>
                  </div>
                </section>
              </div>
              <small v-else class="hint">Bot list is unavailable until admin data is loaded.</small>
            </div>
          </div>

          <div class="row">
            <label class="field grow">
              <span>Only these chat IDs</span>
              <textarea
                v-model="broadcast.chatIdsRaw"
                rows="3"
                placeholder="123456789&#10;987654321"
              />
              <small class="hint">
                One Telegram <code>chat_id</code> per line. When filled, broadcast preview/send is limited to these users on the selected bots.
              </small>
            </label>
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
                Telegram HTML is supported. Allowed tags: <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, <code>&lt;u&gt;</code>, <code>&lt;s&gt;</code>, <code>&lt;code&gt;</code>, <code>&lt;pre&gt;</code>, <code>&lt;blockquote&gt;</code>.
              </small>
            </label>
          </div>

          <div class="row">
            <label class="field grow">
              <span>Inline buttons (optional: JSON or row syntax)</span>
              <textarea
                v-model="broadcast.inlineKeyboardJson"
                rows="5"
                placeholder='[row][Topics][/row]'
              />
              <small class="hint">
                Row syntax examples:
                <code>[row][Topics][/row]</code> (auto maps to <code>topic:menu</code>),
                <code>[row][Open site|https://ai-language-school.online][/row]</code>,
                <code>[row][Topics|topic:menu][Help|https://t.me/your_support][/row]</code>.
                You can also use JSON: <code>[[{"text":"Topics","callback_data":"topic:menu"}]]</code>.
              </small>
            </label>
            <div class="actions">
              <button class="btn" type="button" @click="applyBroadcastTopicsButtonPreset">
                Use Topics preset
              </button>
              <button class="btn danger" type="button" @click="clearBroadcastButtons">
                Clear buttons
              </button>
            </div>
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
              <button class="btn" type="button" :disabled="!password || !hasAnySelectedPlan || !hasSelectedBots || previewLoading" @click="refreshBroadcastPreview()">
                {{ previewLoading ? 'Preview…' : 'Refresh preview' }}
              </button>
              <button class="btn primary" type="button" :disabled="!canSendBroadcast || sendingBroadcast" @click="sendBroadcast">
                {{ sendingBroadcast ? 'Sending…' : `Send to ${fmt(broadcastPreview.count)}` }}
              </button>
            </div>
          </div>

          <div v-if="!password" class="callout">Enter admin password above to use broadcast.</div>
          <div v-else-if="!hasAnySelectedPlan" class="callout">Pick at least one plan.</div>
          <div v-else-if="!hasSelectedBots" class="callout">Pick at least one bot. Cross-language campaigns are disabled.</div>
          <div v-else-if="broadcast.messageKind === 'text' && !broadcast.messageText.trim()" class="callout">Write a message to send.</div>
          <div
            v-else-if="broadcast.messageKind !== 'text' && !hasBroadcastMedia"
            class="callout"
          >
            Upload media (or provide a media URL).
          </div>
          <div v-else-if="broadcastInlineKeyboardError" class="callout error">{{ broadcastInlineKeyboardError }}</div>
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
                    <th>Streak</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in broadcastPreview.sample.slice(0, 8)" :key="`${row.chat_id}-${row.bot_key}`">
                    <td><code>{{ row.chat_id }}</code></td>
                    <td>{{ row.username ? `@${row.username}` : '—' }}</td>
                    <td><span class="bot-badge">{{ row.bot_key }}</span></td>
                    <td>{{ displayTier(row.effective_tier) }}</td>
                    <td>{{ formatLastActivity(row.last_activity_at) }}</td>
                    <td class="num">{{ fmt(row.streak_days || 0) }}</td>
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

    <section class="card panel reminder-test-panel">
      <header class="panel-head">
        <div>
          <div class="panel-kicker">Messaging</div>
          <h2 class="panel-title">Reminder tests</h2>
          <p class="panel-sub">Send an immediate weekly digest, D3, D7, D14, or 50% free limit reminder test to one selected user on one selected bot.</p>
        </div>
        <div class="panel-actions">
          <span class="status-pill" :class="{ warn: automatedMessageTestModeActive }">
            {{ automatedMessageTestModeActive ? `Test allowlist: ${fmt(automatedMessageTestChatIds.length)}` : 'Test allowlist off' }}
          </span>
        </div>
      </header>

      <div class="panel-body">
        <div class="row">
          <label class="field grow">
            <span>Find user</span>
            <input
              v-model.trim="reminderTestUserSearch"
              type="text"
              inputmode="text"
              autocomplete="off"
              placeholder="@username or chat_id"
            />
            <small class="hint">Search, then explicitly pick a single user below.</small>
          </label>
        </div>

        <div v-if="reminderTestLookupError" class="callout error">
          {{ reminderTestLookupError }}
        </div>

        <div v-if="reminderTestSuggestions.length" class="exclude-suggestions">
          <button
            v-for="u in reminderTestSuggestions"
            :key="`reminder-${u.chat_id}`"
            class="exclude-suggestion"
            type="button"
            :disabled="reminderTestSending"
            @click="selectReminderTestUser(u)"
          >
            <div class="exclude-suggestion-main">
              <strong>{{ excludedUserLabel(u) }}</strong>
              <span class="exclude-suggestion-meta"><code>{{ u.chat_id }}</code></span>
            </div>
            <span class="exclude-suggestion-action">Select</span>
          </button>
        </div>

        <div v-if="reminderTestSelectedUser" class="chip-row">
          <button class="exclude-chip" type="button" :disabled="reminderTestSending" @click="clearReminderTestSelection({ clearSearch: true })">
            <span>{{ excludedUserLabel(reminderTestSelectedUser) }} · <code>{{ reminderTestSelectedChatId }}</code></span>
            <span aria-hidden="true" class="exclude-chip-x">×</span>
          </button>
        </div>

        <div class="row">
          <label class="field">
            <span>Bot</span>
            <select v-model="reminderTestBotKey">
              <option value="">Select bot…</option>
              <option v-for="bot in reminderTestBotOptions" :key="`reminder-bot-${bot.bot_key}`" :value="bot.bot_key">
                {{ bot.bot_key }} · {{ languageLabelForCode(bot.base_lang) }} → {{ languageLabelForCode(bot.target_lang) }}
              </option>
            </select>
          </label>

          <label class="field">
            <span>Reminder type</span>
            <select v-model="reminderTestType">
              <option value="weekly_digest">Weekly digest</option>
              <option value="d3">D3</option>
              <option value="d7">D7</option>
              <option value="d14">D14</option>
              <option value="free_limit_50">50% free limit</option>
            </select>
          </label>

          <label class="field">
            <span>Confirm send</span>
            <input
              v-model.trim="reminderTestConfirm"
              type="text"
              autocomplete="off"
              inputmode="text"
              placeholder="Type TEST"
            />
          </label>

          <div class="actions">
            <button class="btn primary" type="button" :disabled="!canSendReminderTest || reminderTestSending" @click="sendReminderTest">
              {{ reminderTestSending ? 'Sending…' : `Send ${reminderTestTypeLabel(reminderTestType)}` }}
            </button>
          </div>
        </div>

        <div v-if="automatedMessageTestModeActive" class="callout">
          Automated message test mode is active. This panel can send only to the configured allowlist chat IDs.
        </div>
        <div v-if="!password" class="callout">Enter admin password above to use reminder tests.</div>
        <div v-else-if="reminderTestAllowlistBlocked" class="callout error">Selected chat is not included in the automated message test allowlist.</div>
        <div v-else-if="!reminderTestSelectedChatId" class="callout">Pick a user first.</div>
        <div v-else-if="!reminderTestBotExists" class="callout">Select a bot explicitly.</div>
        <div v-else-if="reminderTestConfirm.trim().toUpperCase() !== 'TEST'" class="callout">Type TEST to send the reminder immediately.</div>
        <div v-else-if="reminderTestError" class="callout error">{{ reminderTestError }}</div>
        <div v-else-if="reminderTestInfo" class="callout">{{ reminderTestInfo }}</div>

        <div class="sample-card" v-if="reminderTestResult">
          <div class="sample-title">Last reminder test result</div>
          <div class="billing-summary">
            <div class="billing-summary-line">
              <span class="hint">Chat</span>
              <strong><code>{{ reminderTestResult.chat_id }}</code></strong>
            </div>
            <div class="billing-summary-line">
              <span class="hint">Bot</span>
              <strong>{{ reminderTestResult.bot_key }}</strong>
            </div>
            <div class="billing-summary-line">
              <span class="hint">Reminder</span>
              <strong>{{ String(reminderTestResult.reminder_type || '').toUpperCase() }}</strong>
            </div>
            <div class="billing-summary-line">
              <span class="hint">Task type</span>
              <strong><code>{{ reminderTestResult.task_type }}</code></strong>
            </div>
            <div class="billing-summary-line">
              <span class="hint">Telegram message</span>
              <strong><code>{{ reminderTestResult.telegram_message_id || '—' }}</code></strong>
            </div>
          </div>
          <pre class="feedback-text">{{ reminderTestResult.message_text }}</pre>
        </div>
      </div>
    </section>
    </template>

    <section class="card panel" v-else-if="activeTab === 'billing'">
      <header class="panel-head">
        <div>
          <div class="panel-kicker">Billing</div>
          <h2 class="panel-title">Stripe product prices</h2>
          <p class="panel-sub">Create monthly and yearly recurring Stripe prices for the configured product, switch which one is live in checkout, and sync Stripe back into <code>plan_prices</code> for tier <code>pro</code>.</p>
        </div>
        <div class="panel-actions">
          <span class="status-pill subtle" v-if="billingProductId">Product: <code>{{ billingProductId }}</code></span>
          <span class="status-pill subtle" v-if="billingUpdatedAt">Updated: {{ billingUpdatedAt }}</span>
          <button class="btn primary" type="button" :disabled="!password || billingLoading" @click="refreshBillingPrices({ resetMessages: true })">
            {{ billingLoading ? 'Loading…' : 'Refresh' }}
          </button>
          <button class="btn" type="button" :disabled="!password || billingLoading || Boolean(billingMutationBusyId)" @click="syncBillingFromStripe()">
            {{ billingMutationMode === 'sync' ? 'Syncing…' : 'Sync from Stripe' }}
          </button>
        </div>
      </header>

      <div class="panel-body">
        <div v-if="!password" class="callout">Enter admin password above to load Stripe prices.</div>
        <template v-else>
          <div class="billing-layout">
            <section class="billing-pane">
              <div class="pane-title">Create currency bundle</div>
              <div class="row">
                <label class="field">
                  <span>Currency</span>
                  <select v-model="billingCreateDraft.currency" :disabled="billingCurrencyLoading && !billingCurrencyOptions.length">
                    <option value="">
                      {{ billingCurrencyLoading && !billingCurrencyOptions.length ? 'Loading currencies…' : 'Select currency…' }}
                    </option>
                    <option v-for="option in billingCurrencyOptions" :key="option.code" :value="option.code">
                      {{ billingCurrencyOptionLabel(option) }}
                    </option>
                  </select>
                </label>

                <label class="field">
                  <span>Monthly amount (minor units)</span>
                  <input
                    v-model.trim="billingCreateDraft.monthlyAmountCents"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="1000"
                  />
                </label>

                <label class="field">
                  <span>Annual amount (minor units)</span>
                  <input
                    v-model.trim="billingCreateDraft.annualAmountCents"
                    type="number"
                    min="1"
                    step="1"
                    placeholder="10000"
                  />
                </label>
              </div>
              <div v-if="selectedBillingCreateCurrencyMeta" class="billing-summary billing-currency-preview">
                <div class="billing-summary-line">
                  <span class="hint">Symbol</span>
                  <strong>{{ selectedBillingCreateCurrencyMeta.symbol }} · {{ selectedBillingCreateCurrencyMeta.code }}</strong>
                </div>
                <div class="billing-summary-line">
                  <span class="hint">Formatting</span>
                  <strong>{{ billingCurrencyRuleLabel(selectedBillingCreateCurrencyMeta) }}</strong>
                </div>
                <div class="billing-summary-line">
                  <span class="hint">Example</span>
                  <strong>{{ selectedBillingCreateCurrencyMeta.example_format }}</strong>
                </div>
                <div class="billing-summary-line">
                  <span class="hint">Suggested for bases</span>
                  <strong>{{ billingBaseLanguageListLabel(selectedBillingCreateCurrencyMeta.base_languages) }}</strong>
                </div>
                <div class="billing-summary-line">
                  <span class="hint">Monthly preview</span>
                  <strong>{{ billingCreateMonthlyAmountCents === null ? '—' : formatBillingAmountMajor(billingCreateMonthlyAmountCents, billingCreateDraft.currency) || billingMinorUnitsLabel(billingCreateMonthlyAmountCents) }}</strong>
                </div>
                <div class="billing-summary-line">
                  <span class="hint">Annual preview</span>
                  <strong>{{ billingCreateAnnualAmountCents === null ? '—' : formatBillingAmountMajor(billingCreateAnnualAmountCents, billingCreateDraft.currency) || billingMinorUnitsLabel(billingCreateAnnualAmountCents) }}</strong>
                </div>
              </div>
              <p v-else-if="billingCurrencyError" class="hint error">Currency catalog unavailable: {{ billingCurrencyError }}</p>
              <div class="actions">
                <button class="btn primary" type="button" :disabled="!canCreateBillingPrice || Boolean(billingMutationBusyId)" @click="createBillingPrice()">
                  {{ billingMutationMode === 'create' ? 'Creating…' : 'Create monthly + annual' }}
                </button>
              </div>
              <p class="hint">Creates both recurring Stripe prices for this currency and inserts the active runtime mappings in <code>plan_prices</code> for monthly and annual checkout.</p>

              <div class="billing-mini-summary" v-if="billingLivePriceCount || billingArchivedPrices.length">
                <span class="query-chip">Live: {{ fmt(billingLivePriceCount) }}</span>
                <span class="query-chip subtle">Archived: {{ fmt(billingArchivedPrices.length) }}</span>
                <span class="query-chip subtle">Stripe only: {{ fmt(billingStripeOnlyCount) }}</span>
              </div>
            </section>
          </div>

          <div v-if="billingError" class="callout error">{{ billingError }}</div>
          <div v-if="billingInfo" class="callout">{{ billingInfo }}</div>
          <div v-if="billingSyncSummary" class="callout">
            <div class="billing-summary-copy">
              <strong>Sync summary</strong>
              <div class="billing-sync-stats">
                <span>Created: {{ fmt(billingSyncSummary.created?.length || 0) }}</span>
                <span>Updated: {{ fmt(billingSyncSummary.updated?.length || 0) }}</span>
                <span>Removed: {{ fmt(billingSyncSummary.removed?.length || 0) }}</span>
                <span>Unchanged: {{ fmt(billingSyncSummary.unchanged?.length || 0) }}</span>
              </div>
            </div>
          </div>

          <section class="billing-pane">
            <div class="pane-title">Active product prices</div>
            <p class="hint">Each row represents one currency. Replace actions ask for a new amount in minor units, create a fresh Stripe price for that interval, swap the runtime mapping, and archive the previous Stripe price.</p>

            <div v-if="billingCurrencyRows.length" class="sample-table-wrap">
              <table class="sample-table billing-table billing-currency-table">
                <thead>
                  <tr>
                    <th>Currency</th>
                    <th>Monthly price</th>
                    <th>Annual price</th>
                    <th class="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="group in billingCurrencyRows" :key="group.currency">
                    <td>
                      <div class="billing-currency-cell">
                        <strong>{{ billingCurrencyBadge(group.currency) }}</strong>
                        <span class="hint">{{ group.meta?.name || group.currency }}</span>
                      </div>
                    </td>
                    <td>
                      <div v-if="group.monthlyRows.length" class="billing-table-stack">
                        <div v-for="row in group.monthlyRows" :key="row.stripe_price_id" class="billing-table-card" :class="{ active: row.is_runtime_active }">
                          <div class="billing-table-card-head">
                            <strong>{{ billingAmountLabel(row) }}</strong>
                            <span class="chip" :class="billingStatusClass(row)">{{ billingStatusLabel(row) }}</span>
                          </div>
                          <div class="billing-price-card-meta">
                            <span><code>{{ row.stripe_price_id }}</code></span>
                            <span v-if="row.created_at">Created: {{ formatAdminDateTime(row.created_at) }}</span>
                          </div>
                        </div>
                      </div>
                      <span v-else class="hint">—</span>
                    </td>
                    <td>
                      <div v-if="group.annualRows.length" class="billing-table-stack">
                        <div v-for="row in group.annualRows" :key="row.stripe_price_id" class="billing-table-card" :class="{ active: row.is_runtime_active }">
                          <div class="billing-table-card-head">
                            <strong>{{ billingAmountLabel(row) }}</strong>
                            <span class="chip" :class="billingStatusClass(row)">{{ billingStatusLabel(row) }}</span>
                          </div>
                          <div class="billing-price-card-meta">
                            <span><code>{{ row.stripe_price_id }}</code></span>
                            <span v-if="row.created_at">Created: {{ formatAdminDateTime(row.created_at) }}</span>
                          </div>
                        </div>
                      </div>
                      <span v-else class="hint">—</span>
                    </td>
                    <td class="actions">
                      <details class="billing-action-menu">
                        <summary class="btn billing-action-toggle">Show menu</summary>
                        <div class="billing-action-sheet">
                          <button v-if="group.monthlyPrimary" class="btn" type="button" :disabled="Boolean(billingMutationBusyId)" @click="replaceBillingPrice(group.monthlyPrimary)">
                            Replace monthly
                          </button>
                          <button v-if="group.annualPrimary" class="btn" type="button" :disabled="Boolean(billingMutationBusyId)" @click="replaceBillingPrice(group.annualPrimary)">
                            Replace annual
                          </button>
                          <button v-if="group.monthlyPrimary" class="btn danger" type="button" :disabled="Boolean(billingMutationBusyId)" @click="archiveBillingPrice(group.monthlyPrimary)">
                            Archive monthly
                          </button>
                          <button v-if="group.annualPrimary" class="btn danger" type="button" :disabled="Boolean(billingMutationBusyId)" @click="archiveBillingPrice(group.annualPrimary)">
                            Archive annual
                          </button>
                          <button v-if="group.monthlyPrimary && group.annualPrimary" class="btn danger" type="button" :disabled="Boolean(billingMutationBusyId)" @click="archiveBillingCurrency(group)">
                            Archive both
                          </button>
                        </div>
                      </details>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <p v-else-if="!billingLoading" class="hint">No active monthly or annual Stripe prices found for this product.</p>
          </section>

          <section class="billing-pane">
            <div class="pane-title">Archived prices</div>
            <div v-if="billingArchivedPrices.length" class="sample-table-wrap">
              <table class="sample-table billing-table">
                <thead>
                  <tr>
                    <th>Price</th>
                    <th>Status</th>
                    <th>Stripe ID</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="row in billingArchivedPrices" :key="row.stripe_price_id">
                    <td>{{ billingPriceHeading(row) }}</td>
                    <td>{{ billingStatusLabel(row) }}</td>
                    <td><code>{{ row.stripe_price_id }}</code></td>
                    <td>{{ row.created_at ? formatAdminDateTime(row.created_at) : '—' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p v-else-if="!billingLoading" class="hint">No archived prices on the configured product.</p>
          </section>
        </template>
      </div>
    </section>

    <AdminTopicsPanel
      v-else-if="activeTab === 'topics'"
      :api-base="props.apiBase"
      :password="password"
      @stamp="topicsUpdatedAt = $event"
    />

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
      <span v-else-if="activeTab === 'billing' && billingUpdatedAt" class="stamp">Updated: {{ billingUpdatedAt }}</span>
      <span v-else-if="activeTab === 'topics' && topicsUpdatedAt" class="stamp">Updated: {{ topicsUpdatedAt }}</span>
    </footer>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { apiJson } from '../lib/api.js';
import AdminChart from '../components/AdminChart.vue';
import AdminTopicsPanel from '../components/AdminTopicsPanel.vue';

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
  if (preset === 'last_7_days') {
    const from = new Date(todayUtc.getTime() - 6 * DAY_MS);
    return { from: dateToYmdUtc(from), to: dateToYmdUtc(todayUtc) };
  }
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

const rangePresetOptions = [
  { value: 'last_30_days', label: 'Last 30d', hint: 'Rolling window including the current UTC day.' },
  { value: 'last_week', label: 'Last week', hint: 'Previous Monday through Sunday in UTC.' },
  { value: 'last_month', label: 'Last month', hint: 'Previous calendar month in UTC.' }
];

const password = ref('');
const activeTab = ref('analytics');
const { from: defaultFrom, to: defaultTo } = defaultRange();
const fromDate = ref(defaultFrom);
const toDate = ref(defaultTo);
const rangePreset = ref('last_30_days');
const payload = ref('');
const payloadOptions = ref([]);
const EXCLUDED_USERS_LS_KEY = 'admin_dashboard_excluded_users_v1';
const excludeSearch = ref('');
const excludeSuggestions = ref([]);
const excludeLookupError = ref('');
const excludedUsers = ref([]);
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
const topicsUpdatedAt = ref('');
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
const isCustomRange = computed(() => rangePreset.value === 'custom');
const effectiveRange = computed(() => {
  if (isCustomRange.value) {
    return { from: fromDate.value, to: toDate.value };
  }
  return rangeForPreset(rangePreset.value);
});
const effectiveFromDate = computed(() => effectiveRange.value.from);
const effectiveToDate = computed(() => effectiveRange.value.to);

function formatShortUtcDate(ymd) {
  const parsed = parseYmdAsUtc(ymd);
  if (!parsed) return ymd || '—';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(parsed);
}

const activeRangeLabel = computed(() => {
  if (isCustomRange.value) return 'Custom UTC range';
  return rangePresetOptions.find((option) => option.value === rangePreset.value)?.label || 'Preset';
});

const activeRangeText = computed(() => {
  if (isCustomRange.value) return 'Manual range. Dates stay fixed until you change them.';
  return rangePresetOptions.find((option) => option.value === rangePreset.value)?.hint || 'Live UTC preset.';
});

const activeRangeWindow = computed(() => `${formatShortUtcDate(effectiveFromDate.value)} - ${formatShortUtcDate(effectiveToDate.value)}`);

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
const automatedMessageTestModeActive = ref(false);
const automatedMessageTestChatIds = ref([]);

const botSort = reactive({
  key: 'users_last_3_days',
  dir: 'desc' // 'asc' | 'desc'
});

const notificationRows = ref([]);
const notificationBotFilter = ref('all');
const freeUsersBotFilter = ref('all');
const freeUsersLoading = ref(false);
const freeUsersError = ref('');
const newUsersByBotSeries = ref([]);
const newUsersByBotSeriesConfig = ref([]);
const newPaidSeries = ref([]);
const newPaidSeriesConfig = ref([]);
const actionEventsSeries = ref([]);
const actionTotalsSeries = ref([]);
const actionFunnelLast30DaysSeries = ref([]);
const actionFunnelLast7DaysSeries = ref([]);
const replyKeyboardClicksSeries = ref([]);
const replyKeyboardTotalsSeries = ref([]);
const replyKeyboardSummary = ref({
  total_clicks: 0,
  unique_users: 0
});
const topicUsageSeries = ref([]);
const topicUsageSeriesConfig = ref([]);
const activeUsersSeries = ref([]);
const totalUsersSeries = ref([]);
const activeUsersByBotSeries = ref([]);
const activeUsersByBotSeriesConfig = ref([]);
const inactiveUsersSeries = ref([]);
const usageSecondsSeries = ref([]);
const freeUserTotals = ref({
  free_users_all_time: 0,
  free_users_with_voice_in_range: 0,
  free_users_with_messages_in_range: 0,
  engaged_free_users_in_range: 0,
  in_seconds: 0,
  out_seconds: 0,
  sent_messages: 0,
  assistant_messages: 0
});
const freeUsersUsageBuckets = ref([]);
const freeUsersMessageBuckets = ref([]);
const activeUsersByHourSeries = ref([]);
const activeUsersByHourTodaySeries = ref([]);
const userStreakSeries = ref([]);
const xpDistributionSeries = ref([]);
const xpEarnedByDaySeries = ref([]);
const activeUsersChartSeries = computed(() => {
  const totalUsersByDay = new Map(
    totalUsersSeries.value.map((row) => [String(row?.day ?? '').trim(), safeNum(row?.count)])
  );

  return activeUsersSeries.value.map((row) => {
    const day = String(row?.day ?? '').trim();
    return {
      ...row,
      overall: totalUsersByDay.get(day) ?? 0
    };
  });
});
const actionFunnelComparisonSeries = computed(() => {
  const stageKeys = Object.keys(actionFunnelStageMeta);
  const last30ByAction = new Map(
    actionFunnelLast30DaysSeries.value.map((row) => [String(row?.action ?? '').trim(), row])
  );
  const last7ByAction = new Map(
    actionFunnelLast7DaysSeries.value.map((row) => [String(row?.action ?? '').trim(), row])
  );

  return stageKeys.map((action) => {
    const stageMeta = actionFunnelStageMeta[action];
    const last30 = last30ByAction.get(action);
    const last7 = last7ByAction.get(action);
    return {
      day: stageMeta?.label || actionLabel(action),
      last_30_days_count: safeNum(last30?.count),
      last_7_days_count: safeNum(last7?.count),
      last_30_days_pct: safeNum(last30?.pct),
      last_7_days_pct: safeNum(last7?.pct)
    };
  });
});
const activeUsersByHourCombinedSeries = computed(() => {
  const merged = new Map();

  for (const row of activeUsersByHourSeries.value) {
    const hour = String(row?.day ?? '').trim();
    if (!hour) continue;
    if (!merged.has(hour)) merged.set(hour, { day: hour, selected_range: 0, today: 0 });
    merged.get(hour).selected_range = safeNum(row?.count);
  }

  for (const row of activeUsersByHourTodaySeries.value) {
    const hour = String(row?.day ?? '').trim();
    if (!hour) continue;
    if (!merged.has(hour)) merged.set(hour, { day: hour, selected_range: 0, today: 0 });
    merged.get(hour).today = safeNum(row?.count);
  }

  return Array.from(merged.values()).sort((a, b) => String(a.day).localeCompare(String(b.day), undefined, { numeric: true }));
});
const botSeriesPalette = [
  'rgba(31, 107, 99, 0.88)',
  'rgba(199, 90, 36, 0.88)',
  'rgba(46, 88, 142, 0.88)',
  'rgba(103, 78, 167, 0.88)',
  'rgba(33, 124, 146, 0.88)',
  'rgba(174, 43, 40, 0.86)',
  'rgba(117, 156, 56, 0.88)',
  'rgba(140, 87, 45, 0.88)',
  'rgba(187, 64, 122, 0.88)',
  'rgba(81, 102, 120, 0.88)'
];
const botSeriesColors = {
  uk_en: botSeriesPalette[0],
  uk_de: botSeriesPalette[1]
};
const notificationSeriesPalette = [
  'rgba(38, 84, 124, 0.88)',
  'rgba(31, 107, 99, 0.88)',
  'rgba(199, 90, 36, 0.88)',
  'rgba(103, 78, 167, 0.88)',
  'rgba(33, 124, 146, 0.88)',
  'rgba(174, 43, 40, 0.86)',
  'rgba(117, 156, 56, 0.88)',
  'rgba(140, 87, 45, 0.88)',
  'rgba(86, 104, 62, 0.88)'
];
const notificationTypeMeta = {
  onboarding_complete: { label: 'Onboarding complete', color: notificationSeriesPalette[0], order: 0 },
  weekly_digest: { label: 'Weekly digest', color: notificationSeriesPalette[1], order: 1 },
  free_limit_50: { label: '50% free limit', color: notificationSeriesPalette[2], order: 2 },
  winback_d3: { label: 'Winback D3', color: notificationSeriesPalette[3], order: 3 },
  winback_d7: { label: 'Winback D7', color: notificationSeriesPalette[4], order: 4 },
  winback_d14: { label: 'Winback D14', color: notificationSeriesPalette[5], order: 5 },
  broadcast_text: { label: 'Broadcast text', color: notificationSeriesPalette[6], order: 6 },
  broadcast_photo: { label: 'Broadcast photo', color: notificationSeriesPalette[7], order: 7 },
  broadcast_video: { label: 'Broadcast video', color: notificationSeriesPalette[8], order: 8 }
};
const actionSeriesConfig = [
  { key: 'start', label: 'start', color: 'rgba(31, 107, 99, 0.88)' },
  { key: 'profile_set_level', label: 'profile_set_level', color: 'rgba(199, 90, 36, 0.88)' },
  { key: 'first_voice_sent', label: 'first_voice_or_text_sent', color: 'rgba(46, 88, 142, 0.88)' },
  { key: 'first_answer_delivered', label: 'first_answer_delivered', color: 'rgba(103, 78, 167, 0.88)' },
  { key: 'topic_set', label: 'topic_set', color: 'rgba(33, 124, 146, 0.88)' },
  { key: 'topic_message_sent', label: 'topic_message_sent', color: 'rgba(117, 156, 56, 0.88)' },
  { key: 'topic_clear', label: 'topic_clear', color: 'rgba(140, 87, 45, 0.88)' },
  { key: 'day1_return', label: 'day1_return', color: 'rgba(81, 102, 120, 0.88)' },
  { key: 'paywall_shown', label: 'paywall_shown', color: 'rgba(174, 43, 40, 0.86)' },
  { key: 'purchase_success', label: 'purchase_success', color: 'rgba(187, 64, 122, 0.88)' }
];
const replyKeyboardActionMeta = {
  reply_kbd_topic_click: { label: 'Topic', color: 'rgba(31, 107, 99, 0.88)', order: 0 },
  reply_kbd_level_click: { label: 'Level', color: 'rgba(199, 90, 36, 0.88)', order: 1 },
  reply_kbd_voice_click: { label: 'Voice', color: 'rgba(46, 88, 142, 0.88)', order: 2 },
  reply_kbd_xp_click: { label: 'XP', color: 'rgba(103, 78, 167, 0.88)', order: 3 }
};
const replyKeyboardSeriesConfig = Object.entries(replyKeyboardActionMeta)
  .sort((a, b) => a[1].order - b[1].order)
  .map(([key, meta]) => ({
    key,
    label: meta.label,
    color: meta.color
  }));
const actionFunnelStageMeta = {
  start: { label: 'Started', color: 'rgba(38, 84, 124, 0.88)' },
  first_message: { label: 'First message', color: 'rgba(52, 118, 128, 0.88)' },
  onboarding_complete: { label: 'Onboarding complete', color: 'rgba(92, 140, 86, 0.9)' },
  free_limit_half: { label: '50% free limit', color: 'rgba(207, 150, 56, 0.9)' },
  paywall_shown: { label: 'Paywall shown', color: 'rgba(174, 43, 40, 0.86)' }
};
const actionFunnelComparisonChartSeries = [
  {
    key: 'last_30_days_pct',
    label: 'Last 30d',
    color: 'rgba(38, 84, 124, 0.88)',
    barPercentage: 0.56,
    categoryPercentage: 0.78,
    maxBarThickness: 28,
    tooltipExtraKey: 'last_30_days_count',
    tooltipExtraLabel: 'users',
    order: 1
  },
  {
    key: 'last_7_days_pct',
    label: 'Last 7d',
    color: 'rgba(199, 90, 36, 0.88)',
    barPercentage: 0.56,
    categoryPercentage: 0.78,
    maxBarThickness: 28,
    format: 'percent',
    tooltipExtraKey: 'last_7_days_count',
    tooltipExtraLabel: 'users',
    order: 2
  }
];
const topicSeriesPalette = [
  'rgba(31, 107, 99, 0.88)',
  'rgba(199, 90, 36, 0.88)',
  'rgba(46, 88, 142, 0.88)',
  'rgba(103, 78, 167, 0.88)',
  'rgba(33, 124, 146, 0.88)',
  'rgba(174, 43, 40, 0.86)',
  'rgba(117, 156, 56, 0.88)',
  'rgba(140, 87, 45, 0.88)'
];
const topicSeriesColors = {
  routine: topicSeriesPalette[0],
  food: topicSeriesPalette[1],
  travel: topicSeriesPalette[2],
  coffee: topicSeriesPalette[3],
  apartment: topicSeriesPalette[4],
  interview: topicSeriesPalette[5],
  office: topicSeriesPalette[6],
  movies: topicSeriesPalette[7]
};
const usersRows = ref([]);
const usersTotal = ref(0);
const usersOffset = ref(0);
const usersLimit = ref(50);
const usersLoading = ref(false);
const usersError = ref('');
const usersUpdatedAt = ref('');
const userDeleteBusyId = ref('');
const userDeleteError = ref('');
const userDeleteInfo = ref('');
const billingCurrencyCatalog = ref(null);
const billingCurrencyLoading = ref(false);
const billingCurrencyError = ref('');
const billingProductId = ref('');
const billingPrices = ref([]);
const billingLoading = ref(false);
const billingError = ref('');
const billingInfo = ref('');
const billingUpdatedAt = ref('');
const billingMutationBusyId = ref('');
const billingMutationMode = ref('');
const billingSyncSummary = ref(null);
const billingCreateDraft = reactive({
  currency: '',
  monthlyAmountCents: '',
  annualAmountCents: ''
});
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
  if (activeTab.value === 'billing') return billingUpdatedAt.value || '';
  if (activeTab.value === 'topics') return topicsUpdatedAt.value || '';
  if (activeTab.value === 'feedback') return feedbackUpdatedAt.value || '';
  return '';
});

const normalizedBillingCreateCurrency = computed(() => {
  const value = String(billingCreateDraft.currency || '').trim().toLowerCase();
  return /^[a-z]{3}$/.test(value) ? value : '';
});

const billingCurrencyDetails = computed(() => {
  const details = billingCurrencyCatalog.value?.currency_details;
  return details && typeof details === 'object' ? details : {};
});

const billingCurrencyOptions = computed(() => {
  const options = billingCurrencyCatalog.value?.currency_options;
  return Array.isArray(options) ? options : [];
});

const selectedBillingCreateCurrencyMeta = computed(() => {
  const code = String(billingCreateDraft.currency || '').trim().toUpperCase();
  if (!code) return null;
  return billingCurrencyOptions.value.find((item) => item?.code === code) || billingCurrencyDetails.value[code] || null;
});

const billingCreateMonthlyAmountCents = computed(() => {
  const value = String(billingCreateDraft.monthlyAmountCents || '').trim();
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
});

const billingCreateAnnualAmountCents = computed(() => {
  const value = String(billingCreateDraft.annualAmountCents || '').trim();
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
});

const canCreateBillingPrice = computed(() => {
  if (!password.value) return false;
  if (!normalizedBillingCreateCurrency.value) return false;
  if (billingCreateMonthlyAmountCents.value === null) return false;
  if (billingCreateAnnualAmountCents.value === null) return false;
  return true;
});

const billingCurrencyRows = computed(() => {
  const grouped = new Map();
  const activeRows = billingPrices.value.filter((row) => row?.active || row?.is_runtime_active);

  const sortRows = (rows) =>
    rows.slice().sort((a, b) => {
      const rankA = a?.is_runtime_active ? 0 : a?.status === 'stripe_only' ? 1 : 2;
      const rankB = b?.is_runtime_active ? 0 : b?.status === 'stripe_only' ? 1 : 2;
      if (rankA !== rankB) return rankA - rankB;
      const createdA = Date.parse(a?.created_at || '') || 0;
      const createdB = Date.parse(b?.created_at || '') || 0;
      if (createdA !== createdB) return createdB - createdA;
      return String(a?.stripe_price_id || '').localeCompare(String(b?.stripe_price_id || ''));
    });

  for (const row of activeRows) {
    const currency = String(row?.currency || '').trim().toUpperCase();
    if (!currency) continue;
    if (!grouped.has(currency)) {
      grouped.set(currency, {
        currency,
        meta: billingCurrencyMeta(currency),
        monthlyRows: [],
        annualRows: []
      });
    }
    const bucket = grouped.get(currency);
    if (row?.billing_interval === 'year') bucket.annualRows.push(row);
    else bucket.monthlyRows.push(row);
  }

  return [...grouped.values()]
    .map((entry) => {
      const monthlyRows = sortRows(entry.monthlyRows);
      const annualRows = sortRows(entry.annualRows);
      return {
        ...entry,
        monthlyRows,
        annualRows,
        monthlyPrimary: monthlyRows[0] || null,
        annualPrimary: annualRows[0] || null
      };
    })
    .sort((a, b) => a.currency.localeCompare(b.currency));
});

const billingArchivedPrices = computed(() =>
  billingPrices.value.filter((row) => !row?.active && !row?.is_runtime_active)
);

const billingLivePriceCount = computed(() =>
  billingPrices.value.filter((row) => row?.status === 'live').length
);

const billingStripeOnlyCount = computed(() =>
  billingPrices.value.filter((row) => row?.active && row?.status === 'stripe_only').length
);

function usersSortIndicator(key) {
  if (usersSort.key !== key) return '';
  return usersSort.dir === 'asc' ? '↑' : '↓';
}

function toggleUsersSort(key) {
  if (usersSort.key === key) {
    usersSort.dir = usersSort.dir === 'asc' ? 'desc' : 'asc';
  } else {
    usersSort.key = key;
    usersSort.dir = ['created_at', 'last_seen_at', 'streak_days', 'xp_total', 'level'].includes(key) ? 'desc' : 'asc';
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
const BROADCAST_INLINE_KEYBOARD_MAX_ROWS = 8;
const BROADCAST_INLINE_KEYBOARD_MAX_BUTTONS_PER_ROW = 8;
const BROADCAST_INLINE_KEYBOARD_MAX_BUTTON_TEXT_LEN = 64;
const BROADCAST_INLINE_KEYBOARD_MAX_CALLBACK_DATA_LEN = 64;
const BROADCAST_INLINE_KEYBOARD_MAX_URL_LEN = 2048;
const BROADCAST_TOPICS_BUTTON_PRESET = '[row][Topics|topic:menu][/row]';
const broadcast = reactive({
  username: '',
  planFree: true,
  planPro: true,
  lastActivityMode: 'any',
  lastActivityDays: 14,
  usageMode: 'any',
  usagePercent: 80,
  streakMode: 'any',
  streakDays: 3,
  messageKind: 'text',
  mediaUrl: '',
  mediaFileIds: {},
  messageText: '',
  inlineKeyboardJson: '',
  chatIdsRaw: '',
  botKeys: []
});

const broadcastMediaFile = ref(null);
const mediaUploading = ref(false);
const mediaUploadError = ref('');
const mediaUploadInfo = ref('');
const reminderTestUserSearch = ref('');
const reminderTestSuggestions = ref([]);
const reminderTestLookupError = ref('');
const reminderTestSelectedUser = ref(null);
const reminderTestBotKey = ref('');
const reminderTestType = ref('d3');
const reminderTestConfirm = ref('');
const reminderTestSending = ref(false);
const reminderTestError = ref('');
const reminderTestInfo = ref('');
const reminderTestResult = ref(null);

function reminderTestTypeLabel(value) {
  if (value === 'weekly_digest') return 'Weekly digest';
  if (value === 'free_limit_50') return '50% free limit';
  return String(value || '').toUpperCase();
}

const broadcastMediaAccept = computed(() => (broadcast.messageKind === 'photo' ? 'image/*' : 'video/*'));

const hasBroadcastMedia = computed(() => {
  const mediaUrl = broadcast.mediaUrl.trim();
  const ids = broadcast.mediaFileIds && typeof broadcast.mediaFileIds === 'object' ? broadcast.mediaFileIds : {};
  const hasFileIds = Object.keys(ids).length > 0;
  return Boolean(mediaUrl || hasFileIds);
});

function normalizeInlineKeyboardDraft(raw) {
  const payloadRaw = String(raw ?? '').trim();
  if (!payloadRaw) return { value: null, error: '' };

  function parseRowSyntax(text) {
    const lines = String(text || '')
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return { ok: true, rows: [] };

    const rows = [];
    for (const line of lines) {
      const rowMatch = line.match(/^\[row\]([\s\S]*?)\[\/row\]$/i);
      if (!rowMatch) {
        return {
          ok: false,
          error: 'Row syntax: each non-empty line must be [row][Button|action][/row].'
        };
      }

      const inside = rowMatch[1] || '';
      const matches = Array.from(inside.matchAll(/\[([^\]|]+)(?:\|([^\]]+))?\]/g));
      if (matches.length === 0) {
        return {
          ok: false,
          error: 'Each [row] must include at least one [Button|action] item.'
        };
      }

      const row = [];
      for (const match of matches) {
        const textRaw = String(match[1] || '').trim();
        const actionRaw = String(match[2] || '').trim();
        if (!textRaw) {
          return { ok: false, error: 'Button text cannot be empty in row syntax.' };
        }

        let callbackData = '';
        let url = '';
        if (!actionRaw) {
          if (textRaw.toLowerCase() === 'topics') callbackData = 'topic:menu';
          else return { ok: false, error: 'Each button in row syntax needs an action after "|".' };
        } else if (/^https?:\/\//i.test(actionRaw)) {
          url = actionRaw;
        } else if (/^url:/i.test(actionRaw)) {
          url = actionRaw.slice(4).trim();
        } else if (/^(cb|callback):/i.test(actionRaw)) {
          callbackData = actionRaw.replace(/^(cb|callback):/i, '').trim();
        } else {
          callbackData = actionRaw;
        }

        const button = { text: textRaw };
        if (callbackData) button.callback_data = callbackData;
        if (url) button.url = url;
        row.push(button);
      }

      rows.push(row);
    }

    return { ok: true, rows };
  }

  let sourceRows = null;
  try {
    const parsed = JSON.parse(payloadRaw);
    sourceRows = Array.isArray(parsed)
      ? parsed
      : (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.inline_keyboard : null);
  } catch {
    const rowSyntax = parseRowSyntax(payloadRaw);
    if (!rowSyntax.ok) return { value: null, error: rowSyntax.error };
    sourceRows = rowSyntax.rows;
  }

  if (!Array.isArray(sourceRows)) {
    return {
      value: null,
      error: 'Buttons must be JSON array rows or row syntax: [row][Button|action][/row].'
    };
  }
  if (sourceRows.length > BROADCAST_INLINE_KEYBOARD_MAX_ROWS) {
    return { value: null, error: `Too many button rows (max ${BROADCAST_INLINE_KEYBOARD_MAX_ROWS}).` };
  }

  const normalizedRows = [];
  for (const rowRaw of sourceRows) {
    if (!Array.isArray(rowRaw)) {
      return { value: null, error: 'Each button row must be an array.' };
    }
    if (rowRaw.length === 0) continue;
    if (rowRaw.length > BROADCAST_INLINE_KEYBOARD_MAX_BUTTONS_PER_ROW) {
      return { value: null, error: `Too many buttons in a row (max ${BROADCAST_INLINE_KEYBOARD_MAX_BUTTONS_PER_ROW}).` };
    }

    const row = [];
    for (const buttonRaw of rowRaw) {
      if (!buttonRaw || typeof buttonRaw !== 'object' || Array.isArray(buttonRaw)) {
        return { value: null, error: 'Each button must be an object.' };
      }
      const text = String(buttonRaw.text ?? '').trim();
      if (!text) return { value: null, error: 'Every button needs text.' };
      if (text.length > BROADCAST_INLINE_KEYBOARD_MAX_BUTTON_TEXT_LEN) {
        return { value: null, error: `Button text is too long (max ${BROADCAST_INLINE_KEYBOARD_MAX_BUTTON_TEXT_LEN}).` };
      }

      const callbackData = String(buttonRaw.callback_data ?? buttonRaw.callbackData ?? '').trim();
      const url = String(buttonRaw.url ?? '').trim();
      if (callbackData && url) {
        return { value: null, error: 'Each button can have either callback_data or url, not both.' };
      }
      if (!callbackData && !url) {
        return { value: null, error: 'Each button must include callback_data or url.' };
      }
      if (callbackData && callbackData.length > BROADCAST_INLINE_KEYBOARD_MAX_CALLBACK_DATA_LEN) {
        return { value: null, error: `callback_data is too long (max ${BROADCAST_INLINE_KEYBOARD_MAX_CALLBACK_DATA_LEN}).` };
      }
      if (url) {
        if (url.length > BROADCAST_INLINE_KEYBOARD_MAX_URL_LEN) {
          return { value: null, error: `Button URL is too long (max ${BROADCAST_INLINE_KEYBOARD_MAX_URL_LEN}).` };
        }
        let parsedUrl = null;
        try {
          parsedUrl = new URL(url);
        } catch {
          return { value: null, error: 'Button URL must be a valid absolute URL.' };
        }
        if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
          return { value: null, error: 'Button URL must use http:// or https://.' };
        }
      }

      const button = { text };
      if (callbackData) button.callback_data = callbackData;
      if (url) button.url = url;
      row.push(button);
    }

    if (row.length > 0) normalizedRows.push(row);
  }

  return {
    value: normalizedRows.length > 0 ? normalizedRows : null,
    error: ''
  };
}

const broadcastInlineKeyboardState = computed(() => normalizeInlineKeyboardDraft(broadcast.inlineKeyboardJson));
const broadcastInlineKeyboardError = computed(() => broadcastInlineKeyboardState.value.error || '');

function applyBroadcastTopicsButtonPreset() {
  broadcast.inlineKeyboardJson = BROADCAST_TOPICS_BUTTON_PRESET;
}

function clearBroadcastButtons() {
  broadcast.inlineKeyboardJson = '';
}

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

    const data = await apiJson(props.apiBase, '/admin/broadcast-media', {
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

function normalizeBotKeyValue(raw) {
  const value = (raw ?? '').toString().trim().toLowerCase();
  if (!value) return '';
  return value.slice(0, 32);
}

function languageLabelForCode(codeRaw) {
  const code = (codeRaw ?? '').toString().trim().toLowerCase();
  return code ? code.toUpperCase() : 'Unknown';
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

const botStatsByKey = computed(() => {
  const map = new Map();
  for (const bot of botStatsTable.value) {
    const botKey = normalizeBotKeyValue(bot?.bot_key);
    if (!botKey) continue;
    map.set(botKey, {
      ...bot,
      bot_key: botKey,
      base_lang: (bot?.base_lang ?? '').toString().trim().toLowerCase(),
      target_lang: (bot?.target_lang ?? '').toString().trim().toLowerCase()
    });
  }
  return map;
});

const botScopeOptions = computed(() => {
  const map = new Map();

  for (const bot of botStatsTable.value) {
    const botKey = normalizeBotKeyValue(bot?.bot_key);
    if (!botKey) continue;
    map.set(botKey, {
      bot_key: botKey,
      base_lang: (bot?.base_lang ?? '').toString().trim().toLowerCase(),
      target_lang: (bot?.target_lang ?? '').toString().trim().toLowerCase()
    });
  }

  for (const row of notificationRows.value) {
    const botKey = normalizeBotKeyValue(row?.bot_key);
    if (!botKey || map.has(botKey)) continue;
    const langs = parseBotKeyLangs(botKey);
    map.set(botKey, {
      bot_key: botKey,
      base_lang: langs.base_lang,
      target_lang: langs.target_lang
    });
  }

  return Array.from(map.values()).sort((a, b) => String(a.bot_key || '').localeCompare(String(b.bot_key || '')));
});

const notificationChartBundle = computed(() => transformNotificationData(notificationRows.value, notificationBotFilter.value));
const notificationChartSeries = computed(() => notificationChartBundle.value.chartData);
const notificationSeriesConfig = computed(() => notificationChartBundle.value.seriesConfig);
const notificationTotalSent = computed(() => notificationChartBundle.value.totalSent);
const notificationBotFilterLabel = computed(() => {
  if (notificationBotFilter.value === 'all') return 'All bots';
  return botScopeOptions.value.find((bot) => bot.bot_key === notificationBotFilter.value)?.bot_key || notificationBotFilter.value;
});
const notificationChartSubtitle = computed(() => {
  if (notificationBotFilter.value === 'all') {
    return 'Recipient-level automated reminders and broadcasts across all bots.';
  }
  return `Recipient-level automated reminders and broadcasts for ${notificationBotFilterLabel.value}.`;
});
const freeUsersBotFilterLabel = computed(() => {
  if (freeUsersBotFilter.value === 'all') return 'All bots';
  return botScopeOptions.value.find((bot) => bot.bot_key === freeUsersBotFilter.value)?.bot_key || freeUsersBotFilter.value;
});
const freeUsersPanelSubtitle = computed(() => {
  if (freeUsersBotFilter.value === 'all') {
    return 'Current effective tier = free and user is active. Range-based metrics below use the selected UTC dates and optional payload filter.';
  }
  return `Current effective tier = free and user is active in ${freeUsersBotFilterLabel.value}. Range-based metrics below use the selected UTC dates and optional payload filter.`;
});

function sanitizeBroadcastBotKeys(botKeysRaw) {
  const next = [];
  let lockedBaseLang = '';
  for (const rawBotKey of Array.isArray(botKeysRaw) ? botKeysRaw : []) {
    const botKey = normalizeBotKeyValue(rawBotKey);
    if (!botKey || next.includes(botKey)) continue;
    const bot = botStatsByKey.value.get(botKey);
    if (!bot) continue;
    const baseLang = (bot.base_lang ?? '').toString().trim().toLowerCase();
    if (!lockedBaseLang && baseLang) lockedBaseLang = baseLang;
    if (lockedBaseLang && baseLang && baseLang !== lockedBaseLang) continue;
    next.push(botKey);
  }
  return next;
}

const selectedBroadcastBotKeys = computed(() => sanitizeBroadcastBotKeys(broadcast.botKeys));

const selectedBroadcastBaseLang = computed(() => {
  const botKey = selectedBroadcastBotKeys.value[0] || '';
  if (!botKey) return '';
  return (botStatsByKey.value.get(botKey)?.base_lang ?? '').toString().trim().toLowerCase();
});

const automatedMessageTestChatIdSet = computed(() =>
  new Set(
    (Array.isArray(automatedMessageTestChatIds.value) ? automatedMessageTestChatIds.value : [])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean)
  )
);

const reminderTestBotOptions = computed(() =>
  botStatsTable.value
    .slice()
    .sort((a, b) => String(a?.bot_key || '').localeCompare(String(b?.bot_key || '')))
);
const reminderTestBotExists = computed(() =>
  reminderTestBotOptions.value.some((bot) => bot?.bot_key === normalizeBotKeyValue(reminderTestBotKey.value))
);

const reminderTestSelectedChatId = computed(() => String(reminderTestSelectedUser.value?.chat_id ?? '').trim());
const reminderTestAllowlistBlocked = computed(() => {
  if (!automatedMessageTestModeActive.value) return false;
  const chatId = reminderTestSelectedChatId.value;
  if (!chatId) return false;
  return !automatedMessageTestChatIdSet.value.has(chatId);
});

const canSendReminderTest = computed(() => {
  if (!password.value) return false;
  if (!reminderTestSelectedChatId.value) return false;
  if (!normalizeBotKeyValue(reminderTestBotKey.value) || !reminderTestBotExists.value) return false;
  if (!['weekly_digest', 'd3', 'd7', 'd14', 'free_limit_50'].includes(reminderTestType.value)) return false;
  if (reminderTestConfirm.value.trim().toUpperCase() !== 'TEST') return false;
  if (reminderTestAllowlistBlocked.value) return false;
  return true;
});

const broadcastBotGroups = computed(() => {
  const groups = new Map();
  for (const bot of botStatsByKey.value.values()) {
    const baseLang = (bot.base_lang || '').toString().trim().toLowerCase() || 'unknown';
    if (!groups.has(baseLang)) {
      groups.set(baseLang, {
        base_lang: baseLang,
        label: languageLabelForCode(baseLang),
        bots: []
      });
    }
    groups.get(baseLang).bots.push(bot);
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      locked: Boolean(selectedBroadcastBaseLang.value && selectedBroadcastBaseLang.value !== group.base_lang),
      bots: group.bots.slice().sort((a, b) => String(a.bot_key || '').localeCompare(String(b.bot_key || '')))
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
});

function toggleBroadcastBot(botKeyRaw, checked) {
  const botKey = normalizeBotKeyValue(botKeyRaw);
  if (!botKey) return;

  if (!checked) {
    broadcast.botKeys = selectedBroadcastBotKeys.value.filter((value) => value !== botKey);
    return;
  }

  const bot = botStatsByKey.value.get(botKey);
  if (!bot) return;
  const baseLang = (bot.base_lang ?? '').toString().trim().toLowerCase();
  if (selectedBroadcastBaseLang.value && baseLang && selectedBroadcastBaseLang.value !== baseLang) return;

  broadcast.botKeys = [...selectedBroadcastBotKeys.value, botKey];
}

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFromDate.value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveToDate.value)) return false;
  return effectiveFromDate.value <= effectiveToDate.value;
});
const canFetchFeedback = computed(() => {
  if (!password.value) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(feedbackFromDate.value)) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(feedbackToDate.value)) return false;
  return feedbackFromDate.value <= feedbackToDate.value;
});
const feedbackHasNext = computed(() => feedbackOffset.value + feedbackThreads.value.length < feedbackTotal.value);
const usersHasNext = computed(() => usersOffset.value + usersRows.value.length < usersTotal.value);
const totalFreeVoiceSeconds = computed(() => safeNum(freeUserTotals.value.in_seconds) + safeNum(freeUserTotals.value.out_seconds));

function adminHeaders() {
  return { 'X-Admin-Password': password.value };
}

async function refreshBotStats() {
  if (!password.value) return;
  try {
    const headers = adminHeaders();
    const botStatsData = await apiJson(props.apiBase, '/admin/metrics/bot-stats', { headers });
    botStats.value = Array.isArray(botStatsData?.bots) ? botStatsData.bots : [];
    automatedMessageTestModeActive.value = Boolean(botStatsData?.automated_message_test_mode_active);
    automatedMessageTestChatIds.value = Array.isArray(botStatsData?.automated_message_test_chat_ids)
      ? botStatsData.automated_message_test_chat_ids
      : [];
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

function colorForBotSeries(safeKey, index) {
  return botSeriesColors[safeKey] || botSeriesPalette[index % botSeriesPalette.length];
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
  
  const seriesConfig = Array.from(botsSet)
    .sort()
    .map((botKey, index) => {
      const safeKey = botKey.replace(/-/g, '_');
      return {
        key: safeKey,
        label: botKey,
        color: colorForBotSeries(safeKey, index)
      };
    });
  
  return { chartData, seriesConfig };
}

function colorForTopicSeries(safeKey, index) {
  return topicSeriesColors[safeKey] || topicSeriesPalette[index % topicSeriesPalette.length];
}

function notificationSeriesKey(type) {
  return String(type || 'other').replace(/[^a-zA-Z0-9]+/g, '_');
}

function notificationTypeOrder(type) {
  return Number.isFinite(notificationTypeMeta[type]?.order) ? notificationTypeMeta[type].order : 999;
}

function notificationTypeLabel(type) {
  return notificationTypeMeta[type]?.label || String(type || 'other').replaceAll('_', ' ');
}

function colorForNotificationSeries(type, index) {
  return notificationTypeMeta[type]?.color || notificationSeriesPalette[index % notificationSeriesPalette.length];
}

function transformByTopicData(rows) {
  const byDay = {};
  const topicsSet = new Set();

  for (const row of rows) {
    const day = String(row?.day || '').trim();
    const topicId = String(row?.topic_id || 'unknown').trim() || 'unknown';
    const count = Number(row?.count || 0);
    if (!day) continue;

    topicsSet.add(topicId);

    if (!byDay[day]) {
      byDay[day] = { day };
    }

    const safeKey = topicId.replace(/-/g, '_');
    byDay[day][safeKey] = count;
  }

  const chartData = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
  const seriesConfig = Array.from(topicsSet)
    .sort()
    .map((topicId, index) => {
      const safeKey = topicId.replace(/-/g, '_');
      return {
        key: safeKey,
        label: topicLabel(topicId),
        color: colorForTopicSeries(safeKey, index)
      };
    });

  return { chartData, seriesConfig };
}

function transformNotificationData(rows, selectedBotKey = 'all') {
  const byDay = {};
  const totalsByType = new Map();
  const filterBotKey = normalizeBotKeyValue(selectedBotKey);

  for (const row of Array.isArray(rows) ? rows : []) {
    const day = String(row?.day || '').trim();
    const botKey = normalizeBotKeyValue(row?.bot_key);
    const type = String(row?.notification_type || '').trim() || 'other';
    const count = safeNum(row?.count);
    if (!day) continue;
    if (filterBotKey && filterBotKey !== 'all' && botKey !== filterBotKey) continue;

    if (!byDay[day]) byDay[day] = { day };

    const safeKey = notificationSeriesKey(type);
    byDay[day][safeKey] = safeNum(byDay[day][safeKey]) + count;
    totalsByType.set(type, safeNum(totalsByType.get(type)) + count);
  }

  const chartData = Object.values(byDay).sort((a, b) => a.day.localeCompare(b.day));
  const seriesConfig = Array.from(totalsByType.entries())
    .filter(([, total]) => total > 0)
    .sort((a, b) => {
      const order = notificationTypeOrder(a[0]) - notificationTypeOrder(b[0]);
      if (order !== 0) return order;
      return String(a[0]).localeCompare(String(b[0]));
    })
    .map(([type], index) => ({
      key: notificationSeriesKey(type),
      label: notificationTypeLabel(type),
      color: colorForNotificationSeries(type, index)
    }));

  return {
    chartData,
    seriesConfig,
    totalSent: Array.from(totalsByType.values()).reduce((sum, value) => sum + safeNum(value), 0)
  };
}

function query() {
  return {
    from: effectiveFromDate.value,
    to: toExclusiveBoundaryYmd(effectiveToDate.value),
    payload: payload.value.trim() ? payload.value.trim() : undefined
  };
}

const excludedChatIds = computed(() =>
  (Array.isArray(excludedUsers.value) ? excludedUsers.value : [])
    .map((u) => String(u?.chat_id ?? '').trim())
    .filter(Boolean)
);

function analyticsQuery() {
  const base = query();
  const exclude = excludedChatIds.value.length ? excludedChatIds.value.join(',') : undefined;
  return { ...base, exclude_chat_ids: exclude };
}

function freeUsersInsightsQuery() {
  const base = analyticsQuery();
  return {
    ...base,
    bot_key: freeUsersBotFilter.value !== 'all' ? freeUsersBotFilter.value : undefined
  };
}

function safeParseJson(raw, fallback) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function loadExcludedUsersFromStorage() {
  if (typeof localStorage === 'undefined') return;
  const raw = localStorage.getItem(EXCLUDED_USERS_LS_KEY);
  if (!raw) return;

  const parsed = safeParseJson(raw, []);
  if (!Array.isArray(parsed)) return;

  const next = [];
  const seen = new Set();
  for (const item of parsed) {
    const chatId = String(item?.chat_id ?? '').trim();
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    next.push({
      chat_id: chatId,
      username: item?.username ? String(item.username).replace(/^@/, '').trim() : '',
      first_name: item?.first_name ? String(item.first_name).trim() : ''
    });
  }
  excludedUsers.value = next.slice(0, 50);
}

function saveExcludedUsersToStorage() {
  if (typeof localStorage === 'undefined') return;
  const payload = (Array.isArray(excludedUsers.value) ? excludedUsers.value : []).map((u) => ({
    chat_id: String(u?.chat_id ?? '').trim(),
    username: u?.username ? String(u.username).replace(/^@/, '').trim() : '',
    first_name: u?.first_name ? String(u.first_name).trim() : ''
  }));
  try {
    localStorage.setItem(EXCLUDED_USERS_LS_KEY, JSON.stringify(payload));
  } catch {
    // ignore quota issues
  }
}

function excludedUserLabel(u) {
  const username = (u?.username ?? '').toString().replace(/^@/, '').trim();
  if (username) return `@${username}`;
  const name = (u?.first_name ?? '').toString().trim();
  if (name) return name;
  const chatId = String(u?.chat_id ?? '').trim();
  return chatId ? `chat_id ${chatId}` : 'user';
}

function normalizeChatIdCandidate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (!/^\d{4,20}$/.test(s)) return '';
  return s;
}

function addExcludedUser(user) {
  const chatId = String(user?.chat_id ?? '').trim();
  if (!chatId) return;
  if (excludedUsers.value.some((u) => String(u?.chat_id ?? '').trim() === chatId)) return;

  excludedUsers.value = [
    ...excludedUsers.value,
    {
      chat_id: chatId,
      username: user?.username ? String(user.username).replace(/^@/, '').trim() : '',
      first_name: user?.first_name ? String(user.first_name).trim() : ''
    }
  ].slice(0, 50);

  saveExcludedUsersToStorage();
  excludeSearch.value = '';
  excludeSuggestions.value = [];
  excludeLookupError.value = '';

  refreshAnalytics();
}

function removeExcludedUser(chatIdRaw) {
  const chatId = String(chatIdRaw ?? '').trim();
  if (!chatId) return;
  excludedUsers.value = excludedUsers.value.filter((u) => String(u?.chat_id ?? '').trim() !== chatId);
  saveExcludedUsersToStorage();
  excludeLookupError.value = '';
  excludeSuggestions.value = [];
  refreshAnalytics();
}

function clearExcludedUsers() {
  excludedUsers.value = [];
  saveExcludedUsersToStorage();
  excludeLookupError.value = '';
  excludeSuggestions.value = [];
  refreshAnalytics();
}

function addExcludedFromSearch() {
  const raw = excludeSearch.value.trim();
  if (!raw) return;

  const numeric = normalizeChatIdCandidate(raw.replace(/^chat_id\s+/i, ''));
  if (numeric) {
    addExcludedUser({ chat_id: numeric });
    return;
  }

  const normalized = raw.replace(/^@/, '').trim().toLowerCase();
  if (!normalized) return;
  const exact = excludeSuggestions.value.find(
    (u) => (u?.username ?? '').toString().replace(/^@/, '').trim().toLowerCase() === normalized
  );
  if (exact) addExcludedUser(exact);
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

function formatDurationCompact(v) {
  const totalSeconds = Math.max(0, Math.round(safeNum(v)));
  if (totalSeconds < 60) return `${fmt(totalSeconds)}s`;
  if (totalSeconds < 3600) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return seconds ? `${fmt(minutes)}m ${fmt(seconds)}s` : `${fmt(minutes)}m`;
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  return minutes ? `${fmt(hours)}h ${fmt(minutes)}m` : `${fmt(hours)}h`;
}

function parseDateLike(raw) {
  if (raw instanceof Date) return raw;
  const s = String(raw ?? '').trim();
  if (!s) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s) ? s.replace(' ', 'T') : s;
  const d = new Date(normalized);
  return Number.isFinite(d.getTime()) ? d : null;
}

const ADMIN_TIME_ZONE = 'Europe/Vienna';

const adminDateTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: ADMIN_TIME_ZONE,
  timeZoneName: 'short'
});

const adminDateTimeFormatWithSeconds = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  timeZone: ADMIN_TIME_ZONE,
  timeZoneName: 'short'
});

function formatAdminDateTime(raw, { seconds = false } = {}) {
  const d = parseDateLike(raw);
  if (!d) return raw ? String(raw) : '—';
  return (seconds ? adminDateTimeFormatWithSeconds : adminDateTimeFormat).format(d);
}

function isoStampNow() {
  return formatAdminDateTime(new Date(), { seconds: true });
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
  const d = parseDateLike(raw);
  if (!d) return 'unknown time';
  return formatAdminDateTime(d, { seconds: false });
}

function displayTier(rawTier) {
  const tier = (rawTier || '').toString().toLowerCase();
  if (tier === 'free') return 'free';
  if (tier === 'pro') return 'pro';
  return 'pro';
}

function billingIntervalLabel(rawInterval) {
  const value = String(rawInterval || '').trim().toLowerCase();
  if (value === 'month') return 'monthly';
  if (value === 'year') return 'annual';
  return value || 'custom';
}

function billingCurrencyMeta(rawCurrency) {
  const code = String(rawCurrency || '').trim().toUpperCase();
  if (!code) return null;
  return billingCurrencyDetails.value[code] || null;
}

function billingCurrencyBadge(rawCurrency) {
  const code = String(rawCurrency || '').trim().toUpperCase();
  if (!code) return '—';
  const meta = billingCurrencyMeta(code);
  const symbol = String(meta?.symbol || '').trim();
  return symbol && symbol !== code ? `${symbol} ${code}` : code;
}

function formatBillingAmountMajor(rawAmountCents, rawCurrency) {
  const amountCents = Number(rawAmountCents);
  const currency = String(rawCurrency || '').trim().toUpperCase();
  if (!Number.isFinite(amountCents) || !currency) return null;

  const meta = billingCurrencyMeta(currency);
  const minorUnit = Number.isFinite(Number(meta?.minor_unit)) ? Number(meta.minor_unit) : 2;
  const locale = String(meta?.locale || '').trim() || 'en-US';
  const divisor = 10 ** minorUnit;

  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: minorUnit,
      maximumFractionDigits: minorUnit
    }).format(amountCents / divisor);
  } catch {
    return null;
  }
}

function billingMinorUnitsLabel(rawAmountCents) {
  const amountCents = Number(rawAmountCents);
  if (!Number.isFinite(amountCents)) return '—';
  return `${fmt(amountCents)} minor`;
}

function billingAmountLabel(row) {
  const currency = String(row?.currency || '').trim().toUpperCase();
  const amount = Number.isFinite(Number(row?.amount_cents)) ? Number(row.amount_cents) : null;
  if (!currency || amount === null) return '—';
  const formatted = formatBillingAmountMajor(amount, currency);
  const minor = billingMinorUnitsLabel(amount);
  return formatted ? `${formatted} · ${minor}` : `${currency} ${minor}`;
}

function billingPriceHeading(row) {
  const currency = billingCurrencyBadge(row?.currency);
  const interval = billingIntervalLabel(row?.billing_interval);
  return `${currency} · ${interval} · ${billingAmountLabel(row)}`;
}

function billingCurrencyOptionLabel(option) {
  const code = String(option?.code || '').trim().toUpperCase();
  if (!code) return 'Unknown currency';
  const symbol = String(option?.symbol || '').trim();
  const icon = symbol && symbol !== code ? `${symbol} ` : '';
  const sample = String(option?.example_format || '').trim();
  return `${icon}${code} · ${option?.name || code}${sample ? ` · ${sample}` : ''}`;
}

function billingCurrencyRuleLabel(option) {
  if (!option) return '';
  const placement = option?.symbol_position === 'suffix' ? 'symbol last' : 'symbol first';
  const decimal = `decimals "${option?.decimal_separator || '.'}"`;
  const groups = `groups "${option?.group_separator || ','}"`;
  return `${placement} · ${decimal} · ${groups}`;
}

function billingBaseLanguageListLabel(baseLanguages) {
  if (!Array.isArray(baseLanguages) || !baseLanguages.length) return 'general';
  return baseLanguages.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean).join(', ');
}

function billingStatusLabel(row) {
  const status = String(row?.status || '').trim().toLowerCase();
  if (status === 'live') return 'Live in checkout';
  if (status === 'stripe_only') return 'Stripe only';
  if (status === 'archived') return 'Archived';
  if (status === 'runtime_only') return 'Backend only';
  return status || 'Unknown';
}

function billingStatusClass(row) {
  const status = String(row?.status || '').trim().toLowerCase();
  if (status === 'live') return 'live';
  if (status === 'stripe_only') return 'stripe-only';
  if (status === 'archived') return 'archived';
  if (status === 'runtime_only') return 'runtime-only';
  return '';
}

async function replaceBillingPrice(row, amountCentsRaw = null) {
  const priceId = String(row?.stripe_price_id || '').trim();
  const fallbackAmount = row?.amount_cents != null ? String(row.amount_cents) : '';
  const promptValue = amountCentsRaw == null
    ? window.prompt(`New amount in minor units for ${billingPriceHeading(row)}`, fallbackAmount)
    : String(amountCentsRaw);
  if (promptValue === null) return;

  const normalizedAmount = String(promptValue || '').trim();
  if (!/^\d+$/.test(normalizedAmount) || Number(normalizedAmount) <= 0) {
    billingError.value = 'Replace failed: amount must be a positive integer in minor units.';
    return;
  }
  if (!priceId) return;

  billingMutationBusyId.value = priceId;
  billingMutationMode.value = 'replace';
  billingError.value = '';
  billingInfo.value = '';
  billingSyncSummary.value = null;

  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, `/admin/stripe/product-prices/${priceId}/replace`, {
      method: 'POST',
      headers,
      body: {
        amount_cents: Number(normalizedAmount)
      }
    });
    const replaceInfo = `Replaced ${data?.previous_price_id || priceId} with ${data?.price?.stripe_price_id || 'new Stripe price'}.`;
    await refreshBillingPrices();
    billingInfo.value = replaceInfo;
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    billingError.value = `Replace failed: ${msg}`;
  } finally {
    billingMutationBusyId.value = '';
    billingMutationMode.value = '';
  }
}

async function archiveBillingPrices(rows, label = 'selected prices') {
  const targets = (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.stripe_price_id && row?.active && row?.status !== 'runtime_only')
    .map((row) => ({
      id: String(row.stripe_price_id).trim(),
      row
    }));
  if (!targets.length) return;

  const confirmed = window.confirm(
    `Archive ${label}?\n\nThis will set the Stripe price inactive and remove its runtime checkout mapping if one exists.`
  );
  if (!confirmed) return;

  billingError.value = '';
  billingInfo.value = '';
  billingSyncSummary.value = null;

  try {
    const headers = adminHeaders();
    for (const target of targets) {
      billingMutationBusyId.value = target.id;
      billingMutationMode.value = 'archive';
      await apiJson(props.apiBase, `/admin/stripe/product-prices/${target.id}/archive`, {
        method: 'POST',
        headers
      });
    }
    await refreshBillingPrices();
    billingInfo.value = `Archived ${targets.length} price${targets.length === 1 ? '' : 's'} for ${label}.`;
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    billingError.value = `Archive failed: ${msg}`;
  } finally {
    billingMutationBusyId.value = '';
    billingMutationMode.value = '';
  }
}

async function archiveBillingPrice(row) {
  await archiveBillingPrices([row], billingPriceHeading(row));
}

async function archiveBillingCurrency(rowGroup) {
  const targets = [rowGroup?.monthlyPrimary, rowGroup?.annualPrimary].filter(Boolean);
  await archiveBillingPrices(targets, `${rowGroup?.currency || 'currency'} prices`);
}

function userDirectoryLabel(row) {
  const username = (row?.username ?? '').toString().trim();
  if (username) return `@${username}`;
  const firstName = (row?.first_name ?? '').toString().trim();
  if (firstName) return firstName;
  return 'user';
}

function actionLabel(rawAction) {
  const action = (rawAction || '').toString().trim();
  if (action === 'first_voice_sent') return 'first voice or text sent';
  return action.replaceAll('_', ' ');
}

function replyKeyboardActionLabel(rawAction) {
  const action = (rawAction || '').toString().trim();
  return replyKeyboardActionMeta[action]?.label
    || action.replace(/^reply_kbd_/, '').replace(/_click$/, '').replaceAll('_', ' ');
}

function analyticsQueryForRange(range) {
  const exclude = excludedChatIds.value.length ? excludedChatIds.value.join(',') : undefined;
  return {
    from: range.from,
    to: toExclusiveBoundaryYmd(range.to),
    payload: payload.value.trim() ? payload.value.trim() : undefined,
    exclude_chat_ids: exclude
  };
}

function buildActionFunnelSeries(rawSeries) {
  return (Array.isArray(rawSeries) ? rawSeries : []).map((row) => ({
    action: String(row?.action || '').trim(),
    count: Number(row?.count || 0),
    pct: Number(row?.pct || 0)
  }));
}

const replyKeyboardTopActionLabel = computed(() => {
  const rows = Array.isArray(replyKeyboardTotalsSeries.value) ? replyKeyboardTotalsSeries.value : [];
  let best = null;

  for (const row of rows) {
    const clicks = Number(row?.clicks || 0);
    if (!best || clicks > best.clicks) {
      best = {
        action: String(row?.action || '').trim(),
        clicks
      };
    }
  }

  if (!best || best.clicks <= 0) return 'No data';
  return `${replyKeyboardActionLabel(best.action)} (${fmt(best.clicks)})`;
});

function applyFreeUsersInsightsData(freeUsersInsights) {
  freeUserTotals.value = freeUsersInsights?.totals || {
    free_users_all_time: 0,
    free_users_with_voice_in_range: 0,
    free_users_with_messages_in_range: 0,
    engaged_free_users_in_range: 0,
    in_seconds: 0,
    out_seconds: 0,
    sent_messages: 0,
    assistant_messages: 0
  };
  freeUsersUsageBuckets.value = Array.isArray(freeUsersInsights?.usage_buckets) ? freeUsersInsights.usage_buckets : [];
  freeUsersMessageBuckets.value = Array.isArray(freeUsersInsights?.message_buckets) ? freeUsersInsights.message_buckets : [];
}

function topicLabel(rawTopicId) {
  return (rawTopicId || '').toString().trim().replaceAll('_', ' ');
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
const hasSelectedBots = computed(() => selectedBroadcastBotKeys.value.length > 0);
const selectedBroadcastChatIds = computed(() => {
  const parts = String(broadcast.chatIdsRaw ?? '').split(/\r?\n/g);
  const seen = new Set();
  const out = [];
  for (const part of parts) {
    const chatId = normalizeChatIdCandidate(part);
    if (!chatId || seen.has(chatId)) continue;
    seen.add(chatId);
    out.push(chatId);
    if (out.length >= 200) break;
  }
  return out;
});

const broadcastUploadBots = computed(() => selectedBroadcastBotKeys.value.slice());

function broadcastFiltersPayload() {
  const filters = {};
  if (selectedBroadcastChatIds.value.length > 0) {
    filters.chatIds = selectedBroadcastChatIds.value.slice();
    if (selectedBroadcastBotKeys.value.length > 0) {
      filters.bots = selectedBroadcastBotKeys.value.slice();
    }
    return filters;
  }

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

  if (broadcast.streakMode !== 'any') {
    filters.streakMode = broadcast.streakMode;
    if (broadcast.streakMode === 'gte') {
      filters.streakDays = clampInt(broadcast.streakDays, 1, 3650, 3);
    }
  }

  if (selectedBroadcastBotKeys.value.length > 0) {
    filters.bots = selectedBroadcastBotKeys.value.slice();
  }

  return filters;
}

function broadcastRangeQuery() {
  const q = query();
  return {
    from: q.from,
    to: q.to
  };
}

const canSendBroadcast = computed(() => {
  const message = broadcast.messageText.trim();
  const mediaUrl = broadcast.mediaUrl.trim();
  const mediaFileIds = broadcast.mediaFileIds && typeof broadcast.mediaFileIds === 'object' ? broadcast.mediaFileIds : {};
  const hasFileIds = Object.keys(mediaFileIds).length > 0;
  if (!password.value) return false;
  if (!hasAnySelectedPlan.value) return false;
  if (!hasSelectedBots.value) return false;
  if (broadcastInlineKeyboardError.value) return false;
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
  const data = await apiJson(props.apiBase, `/admin/broadcast-campaigns/${campaignId}`, { headers });
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
  if (!hasAnySelectedPlan.value || !hasSelectedBots.value) {
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
    const data = await apiJson(props.apiBase, '/admin/broadcast-campaigns/preview', {
      method: 'POST',
      headers,
      query: broadcastRangeQuery(),
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
    const inlineKeyboard = broadcastInlineKeyboardState.value.value;
    const payloadBody = {
      filters: broadcastFiltersPayload(),
      messageKind: broadcast.messageKind,
      mediaUrl: broadcast.messageKind === 'text' || hasMediaFileIds ? '' : broadcast.mediaUrl.trim(),
      mediaFileIds,
      messageText: broadcast.messageText.trim(),
      inlineKeyboard
    };
    const data = await apiJson(props.apiBase, '/admin/broadcast-campaigns', {
      method: 'POST',
      headers,
      query: broadcastRangeQuery(),
      body: payloadBody
    });

    const campaignId = Number(data?.campaign?.id || 0);
    if (!Number.isFinite(campaignId) || campaignId <= 0) {
      throw new Error('bad_campaign_id');
    }

    sendInfo.value = `Queued campaign #${campaignId} for ${fmt(data?.campaign?.total_recipients || 0)} users.`;
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
  freeUsersError.value = '';
  try {
    const q = analyticsQuery();
    const funnelComparisonQueries = {
      last30Days: analyticsQueryForRange(rangeForPreset('last_30_days')),
      last7Days: analyticsQueryForRange(rangeForPreset('last_7_days'))
    };
    const headers = adminHeaders();
    const [
      summary,
      botStatsData,
      newUsersByBot,
      newPaid,
      actionEvents,
      actionTotals,
      replyKeyboardClicks,
      replyKeyboardTotals,
      actionFunnelLast30Days,
      actionFunnelLast7Days,
      topicsByDay,
      activeUsers,
      totalUsers,
      activeUsersByBot,
      inactiveUsers,
      usageSeconds,
      freeUsersInsights,
      byHour,
      byHourToday,
      userStreaks,
      xpDistribution,
      xpEarnedByDay,
      payloads,
      notificationsByDay
    ] = await Promise.all([
      apiJson(props.apiBase, '/admin/metrics/summary', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/bot-stats', { headers }),
      apiJson(props.apiBase, '/admin/metrics/new-users-by-day-by-bot', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/new-paid-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/actions-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/action-totals', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/reply-keyboard-clicks-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/reply-keyboard-click-totals', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/action-funnel', { query: funnelComparisonQueries.last30Days, headers }),
      apiJson(props.apiBase, '/admin/metrics/action-funnel', { query: funnelComparisonQueries.last7Days, headers }),
      apiJson(props.apiBase, '/admin/metrics/topics-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/total-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-day-by-bot', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/inactive-users-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/usage-seconds-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/free-users-insights', { query: freeUsersInsightsQuery(), headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-hour', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/active-users-by-hour-today', { query: { payload: q.payload, exclude_chat_ids: q.exclude_chat_ids }, headers }),
      apiJson(props.apiBase, '/admin/metrics/user-streaks', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/xp-distribution', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/xp-earned-by-day', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/acquisition-payloads', { query: q, headers }),
      apiJson(props.apiBase, '/admin/metrics/notifications-by-day', { query: q, headers })
    ]);

    totals.value = summary?.totals || totals.value;
    botStats.value = Array.isArray(botStatsData?.bots) ? botStatsData.bots : [];
    automatedMessageTestModeActive.value = Boolean(botStatsData?.automated_message_test_mode_active);
    automatedMessageTestChatIds.value = Array.isArray(botStatsData?.automated_message_test_chat_ids)
      ? botStatsData.automated_message_test_chat_ids
      : [];
    const newPaidRawRows = Array.isArray(newPaid?.series) ? newPaid.series : [];
    const { chartData: newPaidData, seriesConfig: newPaidConfig } = transformByBotData(newPaidRawRows);
    newPaidSeries.value = newPaidData;
    newPaidSeriesConfig.value = newPaidConfig;
    actionEventsSeries.value = Array.isArray(actionEvents?.series) ? actionEvents.series : [];
    actionTotalsSeries.value = Array.isArray(actionTotals?.series)
      ? actionTotals.series.map((row) => ({
          day: actionLabel(row?.action),
          count: Number(row?.count || 0)
        }))
      : [];
    replyKeyboardClicksSeries.value = Array.isArray(replyKeyboardClicks?.series) ? replyKeyboardClicks.series : [];
    replyKeyboardSummary.value = replyKeyboardTotals?.summary || {
      total_clicks: 0,
      unique_users: 0
    };
    replyKeyboardTotalsSeries.value = Array.isArray(replyKeyboardTotals?.series) ? replyKeyboardTotals.series : [];
    actionFunnelLast30DaysSeries.value = buildActionFunnelSeries(actionFunnelLast30Days?.series);
    actionFunnelLast7DaysSeries.value = buildActionFunnelSeries(actionFunnelLast7Days?.series);
    const topicsByDayRawRows = Array.isArray(topicsByDay?.series) ? topicsByDay.series : [];
    const { chartData: topicChartData, seriesConfig: topicChartConfig } = transformByTopicData(topicsByDayRawRows);
    topicUsageSeries.value = topicChartData;
    topicUsageSeriesConfig.value = topicChartConfig;
    activeUsersSeries.value = Array.isArray(activeUsers?.series) ? activeUsers.series : [];
    totalUsersSeries.value = Array.isArray(totalUsers?.series) ? totalUsers.series : [];
    inactiveUsersSeries.value = Array.isArray(inactiveUsers?.series) ? inactiveUsers.series : [];
    usageSecondsSeries.value = Array.isArray(usageSeconds?.series) ? usageSeconds.series : [];
    applyFreeUsersInsightsData(freeUsersInsights);
    activeUsersByHourSeries.value = Array.isArray(byHour?.series) ? byHour.series : [];
    activeUsersByHourTodaySeries.value = Array.isArray(byHourToday?.series) ? byHourToday.series : [];
    userStreakSeries.value = Array.isArray(userStreaks?.series) ? userStreaks.series : [];
    xpDistributionSeries.value = Array.isArray(xpDistribution?.series) ? xpDistribution.series : [];
    xpEarnedByDaySeries.value = Array.isArray(xpEarnedByDay?.series) ? xpEarnedByDay.series : [];
    payloadOptions.value = Array.isArray(payloads?.payloads) ? payloads.payloads : [];
    notificationRows.value = Array.isArray(notificationsByDay?.series) ? notificationsByDay.series : [];
    // Users list is loaded in the Users tab (separate request).
    
    // Transform bot-specific data
    const newUsersByBotRawRows = Array.isArray(newUsersByBot?.series) ? newUsersByBot.series : [];
    const { chartData: newUsersByBotData, seriesConfig: newUsersByBotConfig } = transformByBotData(newUsersByBotRawRows);
    newUsersByBotSeries.value = newUsersByBotData;
    newUsersByBotSeriesConfig.value = newUsersByBotConfig;

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

async function refreshFreeUsersInsights() {
  if (!canFetch.value) return;
  freeUsersLoading.value = true;
  freeUsersError.value = '';
  try {
    const data = await apiJson(props.apiBase, '/admin/metrics/free-users-insights', {
      query: freeUsersInsightsQuery(),
      headers: adminHeaders()
    });
    applyFreeUsersInsightsData(data);
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    freeUsersError.value = `Failed to load free-user usage: ${msg}`;
  } finally {
    freeUsersLoading.value = false;
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

async function refreshBillingCurrencyCatalog() {
  if (billingCurrencyLoading.value) return;
  billingCurrencyLoading.value = true;
  billingCurrencyError.value = '';
  try {
    const data = await apiJson(props.apiBase, '/public/billing/currencies');
    billingCurrencyCatalog.value = data && typeof data === 'object' ? data : null;
  } catch (err) {
    console.error(err);
    billingCurrencyError.value = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
  } finally {
    billingCurrencyLoading.value = false;
  }
}

async function refreshBillingPrices({ resetMessages = false } = {}) {
  if (!password.value) return;
  billingLoading.value = true;
  billingProductId.value = '';
  billingMutationBusyId.value = '';
  billingMutationMode.value = '';
  billingError.value = '';
  if (resetMessages) {
    billingInfo.value = '';
    billingSyncSummary.value = null;
  }
  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/stripe/product-prices', { headers });
    billingProductId.value = String(data?.product_id || '').trim();
    billingPrices.value = Array.isArray(data?.prices) ? data.prices : [];
    billingUpdatedAt.value = isoStampNow();
  } catch (err) {
    console.error(err);
    billingProductId.value = '';
    billingPrices.value = [];
    billingUpdatedAt.value = '';
    const msg = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    billingError.value = `Failed to load Stripe prices: ${msg}`;
  } finally {
    billingLoading.value = false;
  }
}

async function createBillingPrice() {
  if (!canCreateBillingPrice.value) return;

  billingMutationBusyId.value = normalizedBillingCreateCurrency.value;
  billingMutationMode.value = 'create';
  billingError.value = '';
  billingInfo.value = '';
  billingSyncSummary.value = null;

  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/stripe/product-prices', {
      method: 'POST',
      headers,
      body: {
        currency: normalizedBillingCreateCurrency.value,
        monthly_amount_cents: billingCreateMonthlyAmountCents.value,
        annual_amount_cents: billingCreateAnnualAmountCents.value
      }
    });
    const monthId = data?.prices?.month?.stripe_price_id || 'monthly price';
    const yearId = data?.prices?.year?.stripe_price_id || 'annual price';
    const createdInfo = `Created ${String(normalizedBillingCreateCurrency.value || '').toUpperCase()} monthly ${monthId} and annual ${yearId}.`;
    billingCreateDraft.currency = '';
    billingCreateDraft.monthlyAmountCents = '';
    billingCreateDraft.annualAmountCents = '';
    await refreshBillingPrices();
    billingInfo.value = createdInfo;
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    billingError.value = `Create failed: ${msg}`;
  } finally {
    billingMutationBusyId.value = '';
    billingMutationMode.value = '';
  }
}

async function syncBillingFromStripe() {
  if (!password.value) return;
  const confirmed = window.confirm(
    'Sync from Stripe will rebuild plan_prices for tier pro from active monthly and annual Stripe prices on the configured product. Continue?'
  );
  if (!confirmed) return;

  billingMutationBusyId.value = 'sync';
  billingMutationMode.value = 'sync';
  billingError.value = '';
  billingInfo.value = '';
  billingSyncSummary.value = null;

  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/stripe/product-prices/sync', {
      method: 'POST',
      headers
    });
    billingProductId.value = String(data?.product_id || billingProductId.value || '').trim();
    const syncSummary = data?.summary || null;
    await refreshBillingPrices();
    billingSyncSummary.value = syncSummary;
    billingInfo.value = 'Stripe sync completed. Runtime price mappings were rebuilt from active Stripe prices.';
  } catch (err) {
    console.error(err);
    const detail = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    if (err?.payload?.error === 'duplicate_active_prices' && Array.isArray(err?.payload?.conflicts)) {
      const conflictText = err.payload.conflicts
        .map((item) => `${String(item.currency || '').toUpperCase()} ${billingIntervalLabel(item.billing_interval)}: ${(item.stripe_price_ids || []).join(', ')}`)
        .join(' · ');
      billingError.value = `Sync failed: ${detail}${conflictText ? ` (${conflictText})` : ''}`;
    } else {
      billingError.value = `Sync failed: ${detail}`;
    }
  } finally {
    billingMutationBusyId.value = '';
    billingMutationMode.value = '';
  }
}

async function deleteUserCompletely(row) {
  const chatId = String(row?.chat_id ?? '').trim();
  if (!chatId) return;
  if (!password.value) {
    userDeleteError.value = 'Enter admin password first.';
    return;
  }
  if (userDeleteBusyId.value) return;

  const label = userDirectoryLabel(row);
  const confirmDelete = window.confirm(
    `Delete ${label} (${chatId}) permanently?\n\nThis removes the user across all bots, messages, feedback, settings, usage, XP, and payments. This cannot be undone.`
  );
  if (!confirmDelete) return;

  userDeleteBusyId.value = chatId;
  userDeleteError.value = '';
  userDeleteInfo.value = '';
  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/users/delete', {
      method: 'POST',
      headers,
      body: { chatId }
    });
    const deletedTotal = Number(data?.deleted_total || 0);
    userDeleteInfo.value = `Deleted ${chatId}. Removed ${fmt(deletedTotal)} records.`;
    await refreshUsersPage();
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    userDeleteError.value = `Delete failed: ${msg}`;
  } finally {
    userDeleteBusyId.value = '';
  }
}

let excludeLookupTimer = null;
let excludeLookupRequestId = 0;
let reminderTestLookupTimer = null;
let reminderTestLookupRequestId = 0;
let suppressReminderTestSelectionReset = false;

async function refreshExcludeSuggestions() {
  excludeLookupError.value = '';
  const raw = excludeSearch.value.trim();
  if (!raw) {
    excludeSuggestions.value = [];
    return;
  }
  const q = raw.replace(/^@/, '');
  const chatId = normalizeChatIdCandidate(q);
  if (!chatId && q.trim().length < 2) {
    excludeSuggestions.value = [];
    return;
  }
  if (!password.value) {
    excludeSuggestions.value = [];
    return;
  }

  const requestId = ++excludeLookupRequestId;
  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/users/search', {
      query: { q, limit: 8 },
      headers
    });

    if (requestId !== excludeLookupRequestId) return;
    const items = Array.isArray(data?.items) ? data.items : [];
    const excluded = new Set(excludedChatIds.value);
    excludeSuggestions.value = items.filter((u) => !excluded.has(String(u?.chat_id ?? '').trim()));
  } catch (err) {
    if (requestId !== excludeLookupRequestId) return;
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    excludeLookupError.value = `User lookup failed: ${msg}`;
    excludeSuggestions.value = [];
  }
}

function clearReminderTestSelection({ clearSearch = false } = {}) {
  reminderTestSelectedUser.value = null;
  if (clearSearch) reminderTestUserSearch.value = '';
}

function selectReminderTestUser(user) {
  const chatId = String(user?.chat_id ?? '').trim();
  if (!chatId) return;
  reminderTestSelectedUser.value = {
    chat_id: chatId,
    username: user?.username ? String(user.username).replace(/^@/, '').trim() : '',
    first_name: user?.first_name ? String(user.first_name).trim() : ''
  };
  suppressReminderTestSelectionReset = true;
  reminderTestUserSearch.value = '';
  reminderTestSuggestions.value = [];
  reminderTestLookupError.value = '';
  reminderTestError.value = '';
  reminderTestInfo.value = '';
}

async function refreshReminderTestSuggestions() {
  reminderTestLookupError.value = '';
  const raw = reminderTestUserSearch.value.trim();
  if (!raw) {
    reminderTestSuggestions.value = [];
    return;
  }

  const q = raw.replace(/^@/, '');
  const chatId = normalizeChatIdCandidate(q);
  if (!chatId && q.trim().length < 2) {
    reminderTestSuggestions.value = [];
    return;
  }
  if (!password.value) {
    reminderTestSuggestions.value = [];
    return;
  }

  const requestId = ++reminderTestLookupRequestId;
  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/users/search', {
      query: { q, limit: 8 },
      headers
    });
    if (requestId !== reminderTestLookupRequestId) return;
    reminderTestSuggestions.value = Array.isArray(data?.items) ? data.items : [];
  } catch (err) {
    if (requestId !== reminderTestLookupRequestId) return;
    console.error(err);
    const msg = err?.payload?.error || err?.message || 'request_failed';
    reminderTestLookupError.value = `User lookup failed: ${msg}`;
    reminderTestSuggestions.value = [];
  }
}

async function sendReminderTest() {
  if (!canSendReminderTest.value) return;

  reminderTestSending.value = true;
  reminderTestError.value = '';
  reminderTestInfo.value = '';
  reminderTestResult.value = null;

  try {
    const headers = adminHeaders();
    const data = await apiJson(props.apiBase, '/admin/reminders/test-send', {
      method: 'POST',
      headers,
      body: {
        chatId: reminderTestSelectedChatId.value,
        botKey: reminderTestBotKey.value,
        reminderType: reminderTestType.value
      }
    });
    reminderTestResult.value = data || null;
    reminderTestInfo.value = `Sent ${reminderTestTypeLabel(reminderTestType.value)} reminder test.`;
    reminderTestConfirm.value = '';
  } catch (err) {
    console.error(err);
    const msg = err?.payload?.detail || err?.payload?.error || err?.message || 'request_failed';
    reminderTestError.value = `Reminder test failed: ${msg}`;
  } finally {
    reminderTestSending.value = false;
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
}

function applyRangePreset(preset) {
  if (preset === 'custom') {
    selectCustomRange();
    return;
  }
  rangePreset.value = preset;
}

function selectRangePreset(preset) {
  applyRangePreset(preset);
}

function selectCustomRange() {
  if (!isCustomRange.value) {
    fromDate.value = effectiveFromDate.value;
    toDate.value = effectiveToDate.value;
  }
  rangePreset.value = 'custom';
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
  topicsUpdatedAt.value = '';
  clearFeedbackReplyState();
  usersRows.value = [];
  usersTotal.value = 0;
  usersOffset.value = 0;
  usersError.value = '';
  usersUpdatedAt.value = '';
  userDeleteBusyId.value = '';
  userDeleteError.value = '';
  userDeleteInfo.value = '';
  billingProductId.value = '';
  billingPrices.value = [];
  billingLoading.value = false;
  billingError.value = '';
  billingInfo.value = '';
  billingUpdatedAt.value = '';
  billingMutationBusyId.value = '';
  billingMutationMode.value = '';
  billingSyncSummary.value = null;
  billingCreateDraft.currency = '';
  billingCreateDraft.monthlyAmountCents = '';
  billingCreateDraft.annualAmountCents = '';
  automatedMessageTestModeActive.value = false;
  automatedMessageTestChatIds.value = [];
  reminderTestUserSearch.value = '';
  reminderTestSuggestions.value = [];
  reminderTestLookupError.value = '';
  reminderTestSelectedUser.value = null;
  reminderTestBotKey.value = '';
  reminderTestType.value = 'd3';
  reminderTestConfirm.value = '';
  reminderTestSending.value = false;
  reminderTestError.value = '';
  reminderTestInfo.value = '';
  reminderTestResult.value = null;
  freeUsersLoading.value = false;
  freeUsersError.value = '';
  freeUserTotals.value = {
    free_users_all_time: 0,
    free_users_with_voice_in_range: 0,
    free_users_with_messages_in_range: 0,
    engaged_free_users_in_range: 0,
    in_seconds: 0,
    out_seconds: 0,
    sent_messages: 0,
    assistant_messages: 0
  };
  freeUsersUsageBuckets.value = [];
  freeUsersMessageBuckets.value = [];
  notificationRows.value = [];
  replyKeyboardClicksSeries.value = [];
  replyKeyboardTotalsSeries.value = [];
  replyKeyboardSummary.value = {
    total_clicks: 0,
    unique_users: 0
  };
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
  loadExcludedUsersFromStorage();
  // No auto-fetch until password is provided.
});

watch(excludeSearch, () => {
  if (excludeLookupTimer) {
    window.clearTimeout(excludeLookupTimer);
    excludeLookupTimer = null;
  }
  excludeLookupTimer = window.setTimeout(() => {
    refreshExcludeSuggestions();
    excludeLookupTimer = null;
  }, 250);
});

watch(reminderTestUserSearch, (next, prev) => {
  if (suppressReminderTestSelectionReset) {
    suppressReminderTestSelectionReset = false;
  } else if (next !== prev && reminderTestSelectedUser.value) {
    reminderTestSelectedUser.value = null;
  }
  if (reminderTestLookupTimer) {
    window.clearTimeout(reminderTestLookupTimer);
    reminderTestLookupTimer = null;
  }
  reminderTestLookupTimer = window.setTimeout(() => {
    refreshReminderTestSuggestions();
    reminderTestLookupTimer = null;
  }, 250);
});

watch(
  () => [reminderTestSelectedChatId.value, reminderTestBotKey.value, reminderTestType.value].join('|'),
  () => {
    reminderTestError.value = '';
    reminderTestInfo.value = '';
    reminderTestResult.value = null;
  }
);

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
    broadcast.streakMode,
    broadcast.streakDays,
    broadcast.chatIdsRaw,
    rangePreset.value,
    fromDate.value,
    toDate.value,
    selectedBroadcastBotKeys.value.slice().sort().join(',')
  ],
  () => {
    if (!password.value || !hasSelectedBots.value) {
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
    if (tab === 'billing' && billingCurrencyOptions.value.length === 0 && !billingCurrencyLoading.value) {
      refreshBillingCurrencyCatalog();
    }
    if (tab === 'messaging' && password.value && botStats.value.length === 0) {
      refreshBotStats();
    }
    if (tab === 'billing' && password.value && billingPrices.value.length === 0) {
      refreshBillingPrices();
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
  () => [botStats.value.map((bot) => bot.bot_key).join(','), broadcast.botKeys.slice().sort().join(',')],
  () => {
    const next = sanitizeBroadcastBotKeys(broadcast.botKeys);
    if (next.join(',') !== broadcast.botKeys.slice().sort().join(',')) {
      broadcast.botKeys = next;
    }
    if (reminderTestBotKey.value && !reminderTestBotExists.value) {
      reminderTestBotKey.value = '';
    }
    if (notificationBotFilter.value !== 'all' && !botScopeOptions.value.some((bot) => bot.bot_key === notificationBotFilter.value)) {
      notificationBotFilter.value = 'all';
    }
    if (freeUsersBotFilter.value !== 'all' && !botScopeOptions.value.some((bot) => bot.bot_key === freeUsersBotFilter.value)) {
      freeUsersBotFilter.value = 'all';
    }
  }
);

watch(
  () => freeUsersBotFilter.value,
  (next, prev) => {
    if (next === prev) return;
    if (!password.value) return;
    refreshFreeUsersInsights();
  }
);

watch(
  () => selectedBroadcastBotKeys.value.join(','),
  (next, prev) => {
    if (next === prev) return;
    const hasFileIds = Boolean(
      broadcast.mediaFileIds &&
      typeof broadcast.mediaFileIds === 'object' &&
      Object.keys(broadcast.mediaFileIds).length > 0
    );
    if (!hasFileIds) return;
    broadcast.mediaFileIds = {};
    mediaUploadInfo.value = next ? 'Bot selection changed. Upload media again for the current bots.' : '';
  }
);

onBeforeUnmount(() => {
  if (previewTimer) {
    window.clearTimeout(previewTimer);
    previewTimer = null;
  }
  if (excludeLookupTimer) {
    window.clearTimeout(excludeLookupTimer);
    excludeLookupTimer = null;
  }
  if (reminderTestLookupTimer) {
    window.clearTimeout(reminderTestLookupTimer);
    reminderTestLookupTimer = null;
  }
  stopCampaignPolling();
});
</script>

<style scoped>
.shell {
  width: min(1600px, 100%);
  padding: 44px 20px 76px;
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

.status-pill.warn {
  border-color: rgba(199, 90, 36, 0.28);
  background: rgba(199, 90, 36, 0.10);
  color: rgba(145, 63, 21, 0.92);
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

.filter-panel {
  display: grid;
  gap: 12px;
  padding: 14px;
  border-radius: 18px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.72), rgba(246, 241, 232, 0.55));
}

.filter-topline {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: start;
}

.range-toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.preset-chip {
  border: 1px solid rgba(30, 26, 22, 0.14);
  background: rgba(255, 255, 255, 0.74);
  border-radius: 999px;
  padding: 9px 12px;
  min-height: 42px;
  font: inherit;
  font-weight: 650;
  cursor: pointer;
  transition: background 160ms ease, border-color 160ms ease, box-shadow 160ms ease;
}

.preset-chip:hover {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(59, 130, 246, 0.24);
}

.preset-chip.active {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.28);
  box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.1);
}

.preset-chip:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.range-summary-card {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(240px, 0.9fr);
  gap: 12px;
  align-items: center;
  padding: 12px 14px;
  border-radius: 16px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(248, 250, 252, 0.76);
}

.range-summary-card.custom {
  background: rgba(246, 241, 232, 0.72);
}

.range-summary-copy,
.range-summary-window {
  display: grid;
  gap: 4px;
}

.range-summary-kicker,
.range-summary-window-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(30, 26, 22, 0.52);
}

.range-summary-title {
  font-size: 16px;
  letter-spacing: -0.01em;
}

.range-summary-text {
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}

.range-summary-window strong {
  font-size: 14px;
  letter-spacing: -0.01em;
}

.range-custom-row {
  padding-top: 2px;
}

.query-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  min-height: 42px;
  align-items: center;
}

.query-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 8px 11px;
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(255, 255, 255, 0.74);
  font-size: 12px;
  font-weight: 650;
}

.query-chip.subtle {
  font-weight: 550;
  color: var(--muted);
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

.exclude-users-row {
  align-items: end;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.exclude-chip {
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  padding: 8px 10px;
  font: inherit;
  font-size: 12px;
  font-weight: 650;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: background 160ms ease, border-color 160ms ease;
}

.exclude-chip:hover {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(59, 130, 246, 0.22);
}

.exclude-chip:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.exclude-chip-x {
  font-size: 14px;
  line-height: 1;
  opacity: 0.7;
}

.exclude-suggestions {
  display: grid;
  gap: 8px;
}

.exclude-suggestion {
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.66);
  border-radius: 14px;
  padding: 10px 12px;
  font: inherit;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  transition: border-color 160ms ease, box-shadow 160ms ease, background 160ms ease;
}

.exclude-suggestion:hover {
  background: rgba(255, 255, 255, 0.78);
  border-color: rgba(59, 130, 246, 0.22);
  box-shadow: 0 12px 28px rgba(20, 18, 16, 0.10);
}

.exclude-suggestion:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.exclude-suggestion-main {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}

.exclude-suggestion-meta {
  color: var(--muted);
  font-size: 12px;
}

.exclude-suggestion-action {
  font-size: 12px;
  font-weight: 750;
  color: rgba(31, 107, 99, 0.9);
  white-space: nowrap;
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
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.free-users-body {
  gap: 14px;
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

.billing-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}

.billing-pane {
  border-radius: 18px;
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.54);
  padding: 12px;
  display: grid;
  gap: 12px;
}

.billing-mini-summary,
.billing-sync-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
}

.billing-table-card {
  border: 1px solid rgba(30, 26, 22, 0.10);
  background: rgba(255, 255, 255, 0.66);
  border-radius: 14px;
  padding: 10px 11px;
  display: grid;
  gap: 6px;
  text-align: left;
  font: inherit;
  color: inherit;
}

.billing-table-card.active {
  border-color: rgba(31, 107, 99, 0.34);
  background: rgba(31, 107, 99, 0.08);
  box-shadow: 0 14px 28px rgba(20, 18, 16, 0.10);
}

.billing-table-card-head,
.billing-price-card-meta,
.billing-summary-line,
.billing-table-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  align-items: center;
  justify-content: space-between;
}

.billing-price-card-meta {
  justify-content: flex-start;
  font-size: 12px;
  color: var(--muted);
}

.billing-summary {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  border-radius: 14px;
  background: rgba(246, 241, 232, 0.42);
}

.billing-table-actions .btn,
.billing-action-sheet .btn,
.billing-action-toggle {
  min-inline-size: 0;
  padding: 8px 12px;
  font-size: 12px;
  box-shadow: 0 10px 20px rgba(30, 26, 22, 0.12);
}

.billing-table td:last-child,
.billing-table th:last-child {
  white-space: normal;
}

.billing-currency-table td,
.billing-currency-table th {
  vertical-align: top;
}

.billing-currency-cell,
.billing-table-stack {
  display: grid;
  gap: 8px;
}

.billing-action-menu {
  position: relative;
}

.billing-action-menu summary {
  list-style: none;
}

.billing-action-menu summary::-webkit-details-marker {
  display: none;
}

.billing-action-sheet {
  position: absolute;
  inset-block-start: calc(100% + 8px);
  inset-inline-end: 0;
  z-index: 5;
  min-inline-size: 190px;
  display: grid;
  gap: 8px;
  padding: 10px;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.12);
  background: rgba(255, 253, 248, 0.98);
  box-shadow: 0 18px 40px rgba(20, 18, 16, 0.16);
}

.billing-action-sheet .btn {
  justify-content: flex-start;
}

.chip.live {
  background: rgba(31, 107, 99, 0.12);
  border-color: rgba(31, 107, 99, 0.24);
  color: rgba(31, 107, 99, 0.96);
}

.chip.stripe-only {
  background: rgba(59, 130, 246, 0.10);
  border-color: rgba(59, 130, 246, 0.22);
  color: rgba(38, 84, 124, 0.96);
}

.chip.runtime-only {
  background: rgba(140, 87, 45, 0.12);
  border-color: rgba(140, 87, 45, 0.24);
  color: rgba(140, 87, 45, 0.96);
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

.broadcast-groups {
  display: grid;
  gap: 12px;
}

.broadcast-group {
  display: grid;
  gap: 8px;
  padding: 12px;
  border: 1px solid rgba(30, 26, 22, 0.1);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.42);
}

.broadcast-group.locked {
  opacity: 0.58;
}

.broadcast-group-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
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

.pill.disabled {
  cursor: not-allowed;
}

.pill.disabled:hover {
  background: rgba(255, 255, 255, 0.62);
  border-color: rgba(30, 26, 22, 0.14);
}

.pill input {
  height: 14px;
  width: 14px;
  margin: 0;
  cursor: pointer;
}

.pill input:disabled {
  cursor: not-allowed;
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

.users-table th.num,
.users-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.users-table th.actions,
.users-table td.actions {
  text-align: right;
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

.users-delete-btn {
  min-inline-size: 86px;
}

@media (max-width: 820px) {
  .shell {
    padding-inline: 14px;
  }

  .kpi-grid {
    grid-template-columns: 1fr;
  }

  .charts-grid {
    grid-template-columns: 1fr;
  }

  .range-summary-card {
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

  .billing-layout {
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

.notification-toolbar {
  align-items: flex-end;
}

.notification-filter {
  min-width: 180px;
}

.notification-panel-body {
  display: grid;
  gap: 14px;
}

.notification-overview {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

.notification-overview-item {
  display: grid;
  gap: 4px;
  padding: 12px 14px;
  border-radius: 14px;
  border: 1px solid rgba(30, 26, 22, 0.08);
  background: rgba(255, 255, 255, 0.6);
}

.notification-overview-label {
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}

.notification-overview-value {
  font-size: 18px;
  line-height: 1.15;
  color: var(--ink);
}

@media (max-width: 820px) {
  .notification-overview {
    grid-template-columns: 1fr;
  }
}
</style>
