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

// 主界面 Activity - 权限管理、服务控制、多语言支持
// Main Activity - permission management, service control, multi-language support
// Android 系统会根据设备语言自动选择对应的 strings.xml
// Android system automatically selects the matching strings.xml based on device language
class MainActivity : ComponentActivity() {

    private var isServiceRunning by mutableStateOf(false)
    private var hasPermissions by mutableStateOf(false)

    private val requiredPermissions = mutableListOf(
        Manifest.permission.READ_CONTACTS,
        Manifest.permission.WRITE_CONTACTS,
        Manifest.permission.READ_SMS,
        Manifest.permission.READ_CALL_LOG,
        Manifest.permission.READ_PHONE_STATE
    ).apply {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            add(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        hasPermissions = permissions.all { it.value }
        if (hasPermissions && !isServiceRunning) {
            startDroidLinkService()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        checkPermissions()
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
        checkPermissions()
        checkServiceStatus()
    }

    // 检查权限 / Check permissions
    private fun checkPermissions() {
        hasPermissions = requiredPermissions.all { permission ->
            ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED
        }
    }

    // 检查服务状态 / Check service status
    private fun checkServiceStatus() {
        isServiceRunning = DroidLinkService.isRunning
    }

    // 请求权限 / Request permissions
    private fun requestPermissions() {
        permissionLauncher.launch(requiredPermissions.toTypedArray())
    }

    // 启动前台服务 / Start foreground service
    private fun startDroidLinkService() {
        if (!hasPermissions) {
            requestPermissions()
            return
        }
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
        // 所有 UI 文本均来自 strings.xml，支持自动多语言
        // All UI text comes from strings.xml, supports automatic multi-language
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Spacer(modifier = Modifier.height(32.dp))

            // 应用标题 / App title
            Text(
                text = getString(R.string.droidlink_companion),
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(16.dp))

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

            // 权限状态 / Permissions status
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = getString(R.string.permissions_required),
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp
                    )
                    Text(
                        text = if (hasPermissions)
                            getString(R.string.permissions_granted)
                        else
                            getString(R.string.permissions_need_desc),
                        fontSize = 14.sp,
                        color = if (hasPermissions)
                            MaterialTheme.colorScheme.primary
                        else
                            MaterialTheme.colorScheme.error
                    )
                    if (!hasPermissions) {
                        Button(
                            onClick = { requestPermissions() },
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(getString(R.string.grant_permissions))
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))

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
                ),
                enabled = hasPermissions || isServiceRunning
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
}

@Composable
fun DroidLinkTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(),
        content = content
    )
}
