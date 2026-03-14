package com.droidlink.companion

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

// 主界面 Activity - 细粒度权限管理、服务控制、多语言支持
// Main Activity - granular permission management, service control, multi-language support
// 每个功能模块有独立的权限开关，用户可以只授权需要的功能
// Each feature module has independent permission toggle, user can grant only what they need
class MainActivity : ComponentActivity() {

    private var isServiceRunning by mutableStateOf(false)

    // 细粒度权限分组 / Granular permission groups
    // 每个功能模块的权限独立管理 / Each feature's permissions managed independently
    data class PermissionGroup(
        val nameResId: Int,
        val descResId: Int,
        val permissions: List<String>,
        val granted: MutableState<Boolean> = mutableStateOf(false)
    )

    private val contactsGroup = PermissionGroup(
        nameResId = R.string.perm_contacts,
        descResId = R.string.perm_contacts_desc,
        permissions = listOf(
            Manifest.permission.READ_CONTACTS,
            Manifest.permission.WRITE_CONTACTS
        )
    )

    private val smsGroup = PermissionGroup(
        nameResId = R.string.perm_sms,
        descResId = R.string.perm_sms_desc,
        permissions = listOf(Manifest.permission.READ_SMS)
    )

    private val callLogsGroup = PermissionGroup(
        nameResId = R.string.perm_call_logs,
        descResId = R.string.perm_call_logs_desc,
        permissions = listOf(Manifest.permission.READ_CALL_LOG)
    )

    private val phoneGroup = PermissionGroup(
        nameResId = R.string.perm_phone,
        descResId = R.string.perm_phone_desc,
        permissions = listOf(Manifest.permission.READ_PHONE_STATE)
    )

    private val notificationGroup = PermissionGroup(
        nameResId = R.string.perm_notifications,
        descResId = R.string.perm_notifications_desc,
        permissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            listOf(Manifest.permission.POST_NOTIFICATIONS)
        } else {
            emptyList()
        }
    )

    private val permissionGroups: List<PermissionGroup> by lazy {
        listOf(contactsGroup, smsGroup, callLogsGroup, phoneGroup, notificationGroup)
            .filter { it.permissions.isNotEmpty() }
    }

    // 当前正在请求的权限组 / Currently requesting permission group
    private var pendingGroup: PermissionGroup? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        // 更新对应组的授权状态 / Update the requesting group's status
        pendingGroup?.let { group ->
            group.granted.value = group.permissions.all { perm ->
                ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED
            }
        }
        pendingGroup = null
        // 重新检查所有权限状态 / Re-check all permission states
        checkAllPermissions()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        checkAllPermissions()
        checkServiceStatus()

        setContent {
            DroidLinkTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    MainScreen()
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        checkAllPermissions()
        checkServiceStatus()
    }

    // 检查每个权限组的状态 / Check each permission group's status
    private fun checkAllPermissions() {
        for (group in permissionGroups) {
            group.granted.value = group.permissions.all { perm ->
                ContextCompat.checkSelfPermission(this, perm) == PackageManager.PERMISSION_GRANTED
            }
        }
    }

    // 是否有任何权限被授予（服务可以启动） / Whether any permission is granted (service can start)
    private fun hasAnyPermission(): Boolean {
        return permissionGroups.any { it.granted.value }
    }

    // 请求特定组的权限 / Request permissions for a specific group
    private fun requestGroupPermissions(group: PermissionGroup) {
        pendingGroup = group
        permissionLauncher.launch(group.permissions.toTypedArray())
    }

    // 检查服务状态 / Check service status
    private fun checkServiceStatus() {
        isServiceRunning = DroidLinkService.isRunning
    }

    // 启动前台服务（不再要求全部权限） / Start foreground service (no longer requires all permissions)
    private fun startDroidLinkService() {
        val intent = Intent(this, DroidLinkService::class.java)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            startForegroundService(intent)
        } else {
            startService(intent)
        }
        isServiceRunning = true
    }

    // 停止服务 / Stop service
    private fun stopDroidLinkService() {
        val intent = Intent(this, DroidLinkService::class.java)
        stopService(intent)
        isServiceRunning = false
    }

    @Composable
    fun MainScreen() {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.height(16.dp))

            // 应用标题 / App title
            Text(
                text = getString(R.string.droidlink_companion),
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(8.dp))

            // 连接状态卡片 / Connection status card
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = if (isServiceRunning)
                        MaterialTheme.colorScheme.primaryContainer
                    else
                        MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = getString(R.string.connection_status),
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    Text(
                        text = if (isServiceRunning)
                            getString(R.string.service_running)
                        else
                            getString(R.string.service_stopped),
                        fontSize = 14.sp
                    )
                    if (isServiceRunning) {
                        Text(
                            text = getString(R.string.server_address),
                            fontSize = 12.sp,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            }

            // 细粒度权限卡片 / Granular permissions card
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Text(
                        text = getString(R.string.permissions_required),
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    Text(
                        text = getString(R.string.perm_granular_desc),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    // 每个权限组独立显示 / Each permission group shown independently
                    for (group in permissionGroups) {
                        PermissionRow(group)
                    }
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // 启动/停止服务按钮 / Start/Stop service button
            Button(
                onClick = {
                    if (isServiceRunning) stopDroidLinkService()
                    else startDroidLinkService()
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (isServiceRunning)
                        MaterialTheme.colorScheme.error
                    else
                        MaterialTheme.colorScheme.primary
                )
            ) {
                Text(
                    text = if (isServiceRunning)
                        getString(R.string.stop_service)
                    else
                        getString(R.string.start_service),
                    fontSize = 16.sp
                )
            }

            // 安全说明 / Security info
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    Text(
                        text = getString(R.string.security_title),
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                    Text(
                        text = getString(R.string.security_desc),
                        fontSize = 12.sp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        }
    }

    @Composable
    fun PermissionRow(group: PermissionGroup) {
        val granted = group.granted.value
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = getString(group.nameResId),
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = getString(group.descResId),
                    fontSize = 11.sp,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (granted) {
                Text(
                    text = getString(R.string.perm_granted),
                    fontSize = 12.sp,
                    color = MaterialTheme.colorScheme.primary,
                    fontWeight = FontWeight.Bold
                )
            } else {
                Button(
                    onClick = { requestGroupPermissions(group) },
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
                    modifier = Modifier.height(32.dp)
                ) {
                    Text(getString(R.string.perm_grant), fontSize = 12.sp)
                }
            }
        }
    }
}

@Composable
fun DroidLinkTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(),
        content = content
    )
}
