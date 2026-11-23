BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [email] NVARCHAR(254) NOT NULL,
    [displayName] NVARCHAR(200) NOT NULL,
    [passwordHash] NVARCHAR(200) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [User_isActive_df] DEFAULT 1,
    [locale] NVARCHAR(10) NOT NULL CONSTRAINT [User_locale_df] DEFAULT 'es',
    [timezone] NVARCHAR(64) NOT NULL CONSTRAINT [User_timezone_df] DEFAULT 'America/Bogota',
    [isSynthetic] BIT NOT NULL CONSTRAINT [User_isSynthetic_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [User_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Role] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [code] NVARCHAR(64) NOT NULL,
    [description] NVARCHAR(300) NOT NULL,
    CONSTRAINT [Role_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Role_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[Permission] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [code] NVARCHAR(64) NOT NULL,
    [description] NVARCHAR(300) NOT NULL,
    CONSTRAINT [Permission_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Permission_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[UserRole] (
    [userId] UNIQUEIDENTIFIER NOT NULL,
    [roleId] UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT [UserRole_pkey] PRIMARY KEY CLUSTERED ([userId],[roleId])
);

-- CreateTable
CREATE TABLE [dbo].[RolePermission] (
    [roleId] UNIQUEIDENTIFIER NOT NULL,
    [permissionId] UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT [RolePermission_pkey] PRIMARY KEY CLUSTERED ([roleId],[permissionId])
);

-- CreateTable
CREATE TABLE [dbo].[RefreshToken] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [userId] UNIQUEIDENTIFIER NOT NULL,
    [tokenHash] NVARCHAR(64) NOT NULL,
    [familyId] UNIQUEIDENTIFIER NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [revokedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [RefreshToken_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [RefreshToken_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [RefreshToken_tokenHash_key] UNIQUE NONCLUSTERED ([tokenHash])
);

-- CreateTable
CREATE TABLE [dbo].[AuditEvent] (
    [sequence] INT NOT NULL IDENTITY(1,1),
    [occurredAt] DATETIME2 NOT NULL,
    [actorId] UNIQUEIDENTIFIER,
    [action] NVARCHAR(100) NOT NULL,
    [resourceType] NVARCHAR(100) NOT NULL,
    [resourceId] NVARCHAR(100),
    [previousState] NVARCHAR(max),
    [newState] NVARCHAR(max),
    [result] NVARCHAR(16) NOT NULL,
    [reason] NVARCHAR(500),
    [correlationId] NVARCHAR(64) NOT NULL,
    [approvalId] NVARCHAR(64),
    [previousHash] NVARCHAR(64) NOT NULL,
    [hash] NVARCHAR(64) NOT NULL,
    CONSTRAINT [AuditEvent_pkey] PRIMARY KEY CLUSTERED ([sequence]),
    CONSTRAINT [AuditEvent_hash_key] UNIQUE NONCLUSTERED ([hash])
);

-- CreateTable
CREATE TABLE [dbo].[Country] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [code] NVARCHAR(2) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    [timezone] NVARCHAR(64) NOT NULL,
    [locale] NVARCHAR(10) NOT NULL,
    CONSTRAINT [Country_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Country_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[Store] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [code] NVARCHAR(32) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [countryId] UNIQUEIDENTIFIER NOT NULL,
    [isSynthetic] BIT NOT NULL CONSTRAINT [Store_isSynthetic_df] DEFAULT 0,
    CONSTRAINT [Store_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Store_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[TerminalModel] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [vendor] NVARCHAR(64) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    CONSTRAINT [TerminalModel_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TerminalModel_vendor_name_key] UNIQUE NONCLUSTERED ([vendor],[name])
);

-- CreateTable
CREATE TABLE [dbo].[Terminal] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [hostname] NVARCHAR(255) NOT NULL,
    [storeId] UNIQUEIDENTIFIER NOT NULL,
    [modelId] UNIQUEIDENTIFIER NOT NULL,
    [osVersion] NVARCHAR(120) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [Terminal_status_df] DEFAULT 'UNKNOWN',
    [source] NVARCHAR(24) NOT NULL CONSTRAINT [Terminal_source_df] DEFAULT 'SIMULATED',
    [isSynthetic] BIT NOT NULL CONSTRAINT [Terminal_isSynthetic_df] DEFAULT 0,
    [lastInventoryAt] DATETIME2,
    CONSTRAINT [Terminal_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Terminal_hostname_key] UNIQUE NONCLUSTERED ([hostname])
);

-- CreateTable
CREATE TABLE [dbo].[SimulatedTerminalState] (
    [terminalId] UNIQUEIDENTIFIER NOT NULL,
    [failureMode] NVARCHAR(16) NOT NULL CONSTRAINT [SimulatedTerminalState_failureMode_df] DEFAULT 'NONE',
    [scenario] NVARCHAR(200) NOT NULL,
    CONSTRAINT [SimulatedTerminalState_pkey] PRIMARY KEY CLUSTERED ([terminalId])
);

-- CreateTable
CREATE TABLE [dbo].[SimulatedCertificateSlot] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [terminalId] UNIQUEIDENTIFIER NOT NULL,
    [pem] NVARCHAR(max) NOT NULL,
    [storeLocation] NVARCHAR(32) NOT NULL,
    [storeName] NVARCHAR(64) NOT NULL,
    [hasPrivateKey] BIT NOT NULL,
    CONSTRAINT [SimulatedCertificateSlot_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CertificateIssuer] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [kind] NVARCHAR(16) NOT NULL,
    [subjectDn] NVARCHAR(450) NOT NULL,
    [ownerId] UNIQUEIDENTIFIER,
    CONSTRAINT [CertificateIssuer_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CertificateIssuer_subjectDn_key] UNIQUE NONCLUSTERED ([subjectDn])
);

-- CreateTable
CREATE TABLE [dbo].[CertificateOwner] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [email] NVARCHAR(254) NOT NULL,
    [countryId] UNIQUEIDENTIFIER,
    [userId] UNIQUEIDENTIFIER,
    CONSTRAINT [CertificateOwner_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CertificateOwner_email_key] UNIQUE NONCLUSTERED ([email]),
    CONSTRAINT [CertificateOwner_userId_key] UNIQUE NONCLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[CertificatePolicy] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [minKeySizeBits] INT NOT NULL CONSTRAINT [CertificatePolicy_minKeySizeBits_df] DEFAULT 2048,
    [weakSignatures] NVARCHAR(500) NOT NULL CONSTRAINT [CertificatePolicy_weakSignatures_df] DEFAULT '["RSASSA-PKCS1-v1_5-SHA1","ECDSA-SHA1"]',
    [requiredEku] NVARCHAR(64) NOT NULL CONSTRAINT [CertificatePolicy_requiredEku_df] DEFAULT 'clientAuth',
    [alertThresholds] NVARCHAR(100) NOT NULL CONSTRAINT [CertificatePolicy_alertThresholds_df] DEFAULT '[60,30,15,7]',
    [ownerId] UNIQUEIDENTIFIER,
    CONSTRAINT [CertificatePolicy_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CertificatePolicy_name_key] UNIQUE NONCLUSTERED ([name])
);

-- CreateTable
CREATE TABLE [dbo].[Certificate] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [thumbprintSha256] NVARCHAR(64) NOT NULL,
    [subject] NVARCHAR(450) NOT NULL,
    [issuerDn] NVARCHAR(450) NOT NULL,
    [serialNumber] NVARCHAR(128) NOT NULL,
    [notBefore] DATETIME2 NOT NULL,
    [notAfter] DATETIME2 NOT NULL,
    [publicKeyAlgorithm] NVARCHAR(64) NOT NULL,
    [keySizeBits] INT,
    [signatureAlgorithm] NVARCHAR(64) NOT NULL,
    [keyUsage] NVARCHAR(300) NOT NULL,
    [extendedKeyUsage] NVARCHAR(300) NOT NULL,
    [issuerId] UNIQUEIDENTIFIER,
    [ownerId] UNIQUEIDENTIFIER,
    [policyId] UNIQUEIDENTIFIER,
    [renewalStatus] NVARCHAR(32) NOT NULL CONSTRAINT [Certificate_renewalStatus_df] DEFAULT 'NONE',
    [isSynthetic] BIT NOT NULL CONSTRAINT [Certificate_isSynthetic_df] DEFAULT 0,
    [discoveredAt] DATETIME2 NOT NULL,
    [lastVerifiedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Certificate_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Certificate_thumbprintSha256_key] UNIQUE NONCLUSTERED ([thumbprintSha256])
);

-- CreateTable
CREATE TABLE [dbo].[CertificateInstallation] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [certificateId] UNIQUEIDENTIFIER NOT NULL,
    [terminalId] UNIQUEIDENTIFIER NOT NULL,
    [storeLocation] NVARCHAR(32) NOT NULL,
    [storeName] NVARCHAR(64) NOT NULL,
    [hasPrivateKey] BIT NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [CertificateInstallation_status_df] DEFAULT 'PRESENT',
    [firstSeenAt] DATETIME2 NOT NULL,
    [lastSeenAt] DATETIME2 NOT NULL,
    CONSTRAINT [CertificateInstallation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CertificateInstallation_certificateId_terminalId_storeLocation_storeName_key] UNIQUE NONCLUSTERED ([certificateId],[terminalId],[storeLocation],[storeName])
);

-- CreateTable
CREATE TABLE [dbo].[CertificateHistory] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [certificateId] UNIQUEIDENTIFIER NOT NULL,
    [change] NVARCHAR(64) NOT NULL,
    [details] NVARCHAR(max),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CertificateHistory_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [correlationId] NVARCHAR(64),
    CONSTRAINT [CertificateHistory_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[InventoryScan] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [terminalId] UNIQUEIDENTIFIER NOT NULL,
    [requestedById] UNIQUEIDENTIFIER,
    [status] NVARCHAR(16) NOT NULL,
    [source] NVARCHAR(24) NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [finishedAt] DATETIME2,
    [certificatesFound] INT NOT NULL CONSTRAINT [InventoryScan_certificatesFound_df] DEFAULT 0,
    [newCertificates] INT NOT NULL CONSTRAINT [InventoryScan_newCertificates_df] DEFAULT 0,
    [changedCertificates] INT NOT NULL CONSTRAINT [InventoryScan_changedCertificates_df] DEFAULT 0,
    [missingCertificates] INT NOT NULL CONSTRAINT [InventoryScan_missingCertificates_df] DEFAULT 0,
    [alertsCreated] INT NOT NULL CONSTRAINT [InventoryScan_alertsCreated_df] DEFAULT 0,
    [errorSummary] NVARCHAR(max),
    [reportJson] NVARCHAR(max),
    [correlationId] NVARCHAR(64) NOT NULL,
    CONSTRAINT [InventoryScan_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[InventoryFinding] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [scanId] UNIQUEIDENTIFIER NOT NULL,
    [certificateId] UNIQUEIDENTIFIER,
    [kind] NVARCHAR(16) NOT NULL,
    [detail] NVARCHAR(500) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [InventoryFinding_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [InventoryFinding_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Alert] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [certificateId] UNIQUEIDENTIFIER NOT NULL,
    [terminalId] UNIQUEIDENTIFIER NOT NULL,
    [thresholdDays] INT NOT NULL,
    [priority] NVARCHAR(16) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [Alert_status_df] DEFAULT 'OPEN',
    [ownerId] UNIQUEIDENTIFIER,
    [dedupKey] NVARCHAR(120) NOT NULL,
    [notAfter] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Alert_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    [acknowledgedAt] DATETIME2,
    [acknowledgedById] UNIQUEIDENTIFIER,
    [resolvedAt] DATETIME2,
    [escalationLevel] INT NOT NULL CONSTRAINT [Alert_escalationLevel_df] DEFAULT 0,
    [falsePositive] BIT,
    CONSTRAINT [Alert_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Alert_dedupKey_key] UNIQUE NONCLUSTERED ([dedupKey])
);

-- CreateTable
CREATE TABLE [dbo].[Notification] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [alertId] UNIQUEIDENTIFIER NOT NULL,
    [channel] NVARCHAR(24) NOT NULL,
    [recipient] NVARCHAR(254) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Notification_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [Notification_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SecurityFinding] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [type] NVARCHAR(40) NOT NULL,
    [severity] NVARCHAR(16) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [SecurityFinding_status_df] DEFAULT 'OPEN',
    [certificateId] UNIQUEIDENTIFIER,
    [terminalId] UNIQUEIDENTIFIER,
    [dedupKey] NVARCHAR(200) NOT NULL,
    [detail] NVARCHAR(500) NOT NULL,
    [recommendation] NVARCHAR(500) NOT NULL,
    [detectedAt] DATETIME2 NOT NULL,
    [resolvedAt] DATETIME2,
    CONSTRAINT [SecurityFinding_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SecurityFinding_dedupKey_key] UNIQUE NONCLUSTERED ([dedupKey])
);

-- CreateTable
CREATE TABLE [dbo].[AgentIdentity] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [terminalId] UNIQUEIDENTIFIER NOT NULL,
    [publicKeyPem] NVARCHAR(max) NOT NULL,
    [isActive] BIT NOT NULL CONSTRAINT [AgentIdentity_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AgentIdentity_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [AgentIdentity_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AgentIdentity_terminalId_key] UNIQUE NONCLUSTERED ([terminalId])
);

-- CreateTable
CREATE TABLE [dbo].[AgentNonce] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [agentId] UNIQUEIDENTIFIER NOT NULL,
    [nonce] NVARCHAR(100) NOT NULL,
    [receivedAt] DATETIME2 NOT NULL,
    [scanId] UNIQUEIDENTIFIER,
    CONSTRAINT [AgentNonce_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AgentNonce_agentId_nonce_key] UNIQUE NONCLUSTERED ([agentId],[nonce])
);

-- CreateTable
CREATE TABLE [dbo].[MaintenanceWindow] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [startsAt] DATETIME2 NOT NULL,
    [endsAt] DATETIME2 NOT NULL,
    [countryCode] NVARCHAR(2),
    [isActive] BIT NOT NULL CONSTRAINT [MaintenanceWindow_isActive_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MaintenanceWindow_createdAt_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [MaintenanceWindow_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[RenewalRequest] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [certificateId] UNIQUEIDENTIFIER NOT NULL,
    [requestedById] UNIQUEIDENTIFIER NOT NULL,
    [status] NVARCHAR(24) NOT NULL CONSTRAINT [RenewalRequest_status_df] DEFAULT 'REQUESTED',
    [reason] NVARCHAR(500),
    [issuanceEvidence] NVARCHAR(max),
    [newCertificatePem] NVARCHAR(max),
    [newCertificateId] UNIQUEIDENTIFIER,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    CONSTRAINT [RenewalRequest_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[RenewalTarget] (
    [renewalId] UNIQUEIDENTIFIER NOT NULL,
    [terminalId] UNIQUEIDENTIFIER NOT NULL,
    CONSTRAINT [RenewalTarget_pkey] PRIMARY KEY CLUSTERED ([renewalId],[terminalId])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalRequest] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [renewalId] UNIQUEIDENTIFIER NOT NULL,
    [requestedById] UNIQUEIDENTIFIER NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [ApprovalRequest_status_df] DEFAULT 'PENDING',
    [parametersHash] NVARCHAR(64) NOT NULL,
    [maintenanceWindowId] UNIQUEIDENTIFIER,
    [justification] NVARCHAR(500),
    [invalidatedReason] NVARCHAR(300),
    [createdAt] DATETIME2 NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [ApprovalRequest_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ApprovalDecision] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [approvalId] UNIQUEIDENTIFIER NOT NULL,
    [deciderId] UNIQUEIDENTIFIER NOT NULL,
    [decision] NVARCHAR(16) NOT NULL,
    [justification] NVARCHAR(500) NOT NULL,
    [decidedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ApprovalDecision_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DeploymentJob] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [renewalId] UNIQUEIDENTIFIER NOT NULL,
    [approvalId] UNIQUEIDENTIFIER NOT NULL,
    [maintenanceWindowId] UNIQUEIDENTIFIER,
    [createdById] UNIQUEIDENTIFIER NOT NULL,
    [executorId] UNIQUEIDENTIFIER,
    [mode] NVARCHAR(16) NOT NULL CONSTRAINT [DeploymentJob_mode_df] DEFAULT 'SIMULATION',
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [DeploymentJob_status_df] DEFAULT 'SCHEDULED',
    [scheduledAt] DATETIME2 NOT NULL,
    [startedAt] DATETIME2,
    [finishedAt] DATETIME2,
    [idempotencyKey] NVARCHAR(100) NOT NULL,
    [simulateFailure] NVARCHAR(24) NOT NULL CONSTRAINT [DeploymentJob_simulateFailure_df] DEFAULT 'NONE',
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [DeploymentJob_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DeploymentJob_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[DeploymentTarget] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [jobId] UNIQUEIDENTIFIER NOT NULL,
    [terminalId] UNIQUEIDENTIFIER NOT NULL,
    [status] NVARCHAR(20) NOT NULL CONSTRAINT [DeploymentTarget_status_df] DEFAULT 'PENDING',
    [previousSlotsJson] NVARCHAR(max),
    CONSTRAINT [DeploymentTarget_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DeploymentTarget_jobId_terminalId_key] UNIQUE NONCLUSTERED ([jobId],[terminalId])
);

-- CreateTable
CREATE TABLE [dbo].[DeploymentAttempt] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [targetId] UNIQUEIDENTIFIER NOT NULL,
    [attemptNo] INT NOT NULL,
    [startedAt] DATETIME2 NOT NULL,
    [finishedAt] DATETIME2,
    [outcome] NVARCHAR(16) NOT NULL,
    [errorMessage] NVARCHAR(500),
    [correlationId] NVARCHAR(64) NOT NULL,
    CONSTRAINT [DeploymentAttempt_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[VerificationResult] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [targetId] UNIQUEIDENTIFIER NOT NULL,
    [passed] BIT NOT NULL,
    [detail] NVARCHAR(500) NOT NULL,
    [verifiedAt] DATETIME2 NOT NULL,
    CONSTRAINT [VerificationResult_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[RollbackOperation] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [targetId] UNIQUEIDENTIFIER NOT NULL,
    [reason] NVARCHAR(500) NOT NULL,
    [previousState] NVARCHAR(max),
    [outcome] NVARCHAR(16) NOT NULL,
    [evidence] NVARCHAR(max),
    [executedById] UNIQUEIDENTIFIER NOT NULL,
    [executedAt] DATETIME2 NOT NULL,
    CONSTRAINT [RollbackOperation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ConfigurationPolicy] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [key] NVARCHAR(100) NOT NULL,
    [value] NVARCHAR(500) NOT NULL,
    [description] NVARCHAR(300) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [ConfigurationPolicy_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ConfigurationPolicy_key_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[Incident] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [severity] NVARCHAR(4) NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [resolvedAt] DATETIME2,
    [certificateId] UNIQUEIDENTIFIER,
    [terminalId] UNIQUEIDENTIFIER,
    [countryCode] NVARCHAR(2),
    [period] NVARCHAR(12) NOT NULL,
    [isSynthetic] BIT NOT NULL CONSTRAINT [Incident_isSynthetic_df] DEFAULT 0,
    [createdById] UNIQUEIDENTIFIER,
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [Incident_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MetricDefinition] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [code] NVARCHAR(40) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [formula] NVARCHAR(500) NOT NULL,
    [unit] NVARCHAR(24) NOT NULL,
    [description] NVARCHAR(500) NOT NULL,
    [source] NVARCHAR(200) NOT NULL,
    CONSTRAINT [MetricDefinition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MetricDefinition_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[MetricTarget] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [metricCode] NVARCHAR(40) NOT NULL,
    [comparator] NVARCHAR(4) NOT NULL,
    [targetValue] FLOAT(53) NOT NULL,
    [justification] NVARCHAR(500) NOT NULL,
    [source] NVARCHAR(200) NOT NULL,
    [responsible] NVARCHAR(200) NOT NULL,
    [setAt] DATETIME2 NOT NULL,
    [approvalStatus] NVARCHAR(12) NOT NULL CONSTRAINT [MetricTarget_approvalStatus_df] DEFAULT 'PROPOSED',
    CONSTRAINT [MetricTarget_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MetricTarget_metricCode_key] UNIQUE NONCLUSTERED ([metricCode])
);

-- CreateTable
CREATE TABLE [dbo].[BaselineSnapshot] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [kind] NVARCHAR(12) NOT NULL,
    [label] NVARCHAR(200) NOT NULL,
    [periodStart] DATETIME2 NOT NULL,
    [periodEnd] DATETIME2 NOT NULL,
    [notes] NVARCHAR(500),
    [isSynthetic] BIT NOT NULL CONSTRAINT [BaselineSnapshot_isSynthetic_df] DEFAULT 0,
    [createdById] UNIQUEIDENTIFIER,
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [BaselineSnapshot_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MetricObservation] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [snapshotId] UNIQUEIDENTIFIER NOT NULL,
    [metricCode] NVARCHAR(40) NOT NULL,
    [value] FLOAT(53),
    [numerator] FLOAT(53),
    [denominator] FLOAT(53),
    [sampleSize] INT NOT NULL,
    CONSTRAINT [MetricObservation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchSample] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [countries] NVARCHAR(200) NOT NULL,
    [storesCount] INT NOT NULL,
    [terminalsCount] INT NOT NULL,
    [certificatesObserved] INT NOT NULL,
    [informants] INT NOT NULL,
    [ticketsAnalyzed] INT NOT NULL,
    [periodStart] DATETIME2 NOT NULL,
    [periodEnd] DATETIME2 NOT NULL,
    [inclusionCriteria] NVARCHAR(500) NOT NULL,
    [exclusionCriteria] NVARCHAR(500) NOT NULL,
    [isSynthetic] BIT NOT NULL CONSTRAINT [ResearchSample_isSynthetic_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [ResearchSample_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[UsabilitySurvey] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [respondentRole] NVARCHAR(64) NOT NULL,
    [answers] NVARCHAR(100) NOT NULL,
    [score] FLOAT(53) NOT NULL,
    [isSynthetic] BIT NOT NULL CONSTRAINT [UsabilitySurvey_isSynthetic_df] DEFAULT 0,
    [submittedAt] DATETIME2 NOT NULL,
    [createdById] UNIQUEIDENTIFIER,
    CONSTRAINT [UsabilitySurvey_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ExperimentalRun] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [code] NVARCHAR(40) NOT NULL,
    [objective] NVARCHAR(300) NOT NULL,
    [requirementCode] NVARCHAR(16) NOT NULL,
    [scenario] NVARCHAR(200) NOT NULL,
    [ranAt] DATETIME2 NOT NULL,
    [environment] NVARCHAR(100) NOT NULL,
    [operatorId] UNIQUEIDENTIFIER,
    [sample] NVARCHAR(300) NOT NULL,
    [parameters] NVARCHAR(max) NOT NULL,
    [expectedResult] NVARCHAR(500) NOT NULL,
    [obtainedResult] NVARCHAR(500) NOT NULL,
    [metrics] NVARCHAR(max) NOT NULL,
    [status] NVARCHAR(12) NOT NULL,
    [limitations] NVARCHAR(500) NOT NULL,
    [trlLevel] INT,
    [isSynthetic] BIT NOT NULL CONSTRAINT [ExperimentalRun_isSynthetic_df] DEFAULT 1,
    [correlationId] NVARCHAR(64),
    CONSTRAINT [ExperimentalRun_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ExperimentalRun_code_key] UNIQUE NONCLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[TestEvidence] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [runId] UNIQUEIDENTIFIER NOT NULL,
    [kind] NVARCHAR(24) NOT NULL,
    [description] NVARCHAR(300) NOT NULL,
    [content] NVARCHAR(max) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [TestEvidence_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TraceabilityItem] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [requirementCode] NVARCHAR(16) NOT NULL,
    [objectiveCode] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [module] NVARCHAR(200) NOT NULL,
    [component] NVARCHAR(300) NOT NULL,
    [testCase] NVARCHAR(300),
    [testResult] NVARCHAR(300),
    [status] NVARCHAR(16) NOT NULL,
    [evidenceRunId] UNIQUEIDENTIFIER,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [TraceabilityItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TraceabilityItem_requirementCode_key] UNIQUE NONCLUSTERED ([requirementCode])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RefreshToken_userId_idx] ON [dbo].[RefreshToken]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RefreshToken_familyId_idx] ON [dbo].[RefreshToken]([familyId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditEvent_actorId_idx] ON [dbo].[AuditEvent]([actorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditEvent_action_idx] ON [dbo].[AuditEvent]([action]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditEvent_resourceType_resourceId_idx] ON [dbo].[AuditEvent]([resourceType], [resourceId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditEvent_correlationId_idx] ON [dbo].[AuditEvent]([correlationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Store_countryId_idx] ON [dbo].[Store]([countryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Terminal_storeId_idx] ON [dbo].[Terminal]([storeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SimulatedCertificateSlot_terminalId_idx] ON [dbo].[SimulatedCertificateSlot]([terminalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Certificate_notAfter_idx] ON [dbo].[Certificate]([notAfter]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Certificate_issuerId_idx] ON [dbo].[Certificate]([issuerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Certificate_ownerId_idx] ON [dbo].[Certificate]([ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CertificateInstallation_terminalId_idx] ON [dbo].[CertificateInstallation]([terminalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CertificateHistory_certificateId_idx] ON [dbo].[CertificateHistory]([certificateId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryScan_terminalId_startedAt_idx] ON [dbo].[InventoryScan]([terminalId], [startedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [InventoryFinding_scanId_idx] ON [dbo].[InventoryFinding]([scanId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Alert_status_idx] ON [dbo].[Alert]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Alert_certificateId_terminalId_idx] ON [dbo].[Alert]([certificateId], [terminalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_alertId_idx] ON [dbo].[Notification]([alertId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SecurityFinding_status_idx] ON [dbo].[SecurityFinding]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RenewalRequest_status_idx] ON [dbo].[RenewalRequest]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RenewalRequest_certificateId_idx] ON [dbo].[RenewalRequest]([certificateId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalRequest_renewalId_idx] ON [dbo].[ApprovalRequest]([renewalId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ApprovalRequest_status_idx] ON [dbo].[ApprovalRequest]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DeploymentJob_status_idx] ON [dbo].[DeploymentJob]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MetricObservation_snapshotId_idx] ON [dbo].[MetricObservation]([snapshotId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ExperimentalRun_requirementCode_idx] ON [dbo].[ExperimentalRun]([requirementCode]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TestEvidence_runId_idx] ON [dbo].[TestEvidence]([runId]);

-- AddForeignKey
ALTER TABLE [dbo].[UserRole] ADD CONSTRAINT [UserRole_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[UserRole] ADD CONSTRAINT [UserRole_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RolePermission] ADD CONSTRAINT [RolePermission_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RolePermission] ADD CONSTRAINT [RolePermission_permissionId_fkey] FOREIGN KEY ([permissionId]) REFERENCES [dbo].[Permission]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RefreshToken] ADD CONSTRAINT [RefreshToken_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Store] ADD CONSTRAINT [Store_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Terminal] ADD CONSTRAINT [Terminal_storeId_fkey] FOREIGN KEY ([storeId]) REFERENCES [dbo].[Store]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Terminal] ADD CONSTRAINT [Terminal_modelId_fkey] FOREIGN KEY ([modelId]) REFERENCES [dbo].[TerminalModel]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SimulatedTerminalState] ADD CONSTRAINT [SimulatedTerminalState_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SimulatedCertificateSlot] ADD CONSTRAINT [SimulatedCertificateSlot_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[SimulatedTerminalState]([terminalId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CertificateIssuer] ADD CONSTRAINT [CertificateIssuer_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[CertificateOwner]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CertificateOwner] ADD CONSTRAINT [CertificateOwner_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CertificateOwner] ADD CONSTRAINT [CertificateOwner_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CertificatePolicy] ADD CONSTRAINT [CertificatePolicy_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[CertificateOwner]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Certificate] ADD CONSTRAINT [Certificate_issuerId_fkey] FOREIGN KEY ([issuerId]) REFERENCES [dbo].[CertificateIssuer]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Certificate] ADD CONSTRAINT [Certificate_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[CertificateOwner]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Certificate] ADD CONSTRAINT [Certificate_policyId_fkey] FOREIGN KEY ([policyId]) REFERENCES [dbo].[CertificatePolicy]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CertificateInstallation] ADD CONSTRAINT [CertificateInstallation_certificateId_fkey] FOREIGN KEY ([certificateId]) REFERENCES [dbo].[Certificate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CertificateInstallation] ADD CONSTRAINT [CertificateInstallation_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CertificateHistory] ADD CONSTRAINT [CertificateHistory_certificateId_fkey] FOREIGN KEY ([certificateId]) REFERENCES [dbo].[Certificate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryScan] ADD CONSTRAINT [InventoryScan_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryFinding] ADD CONSTRAINT [InventoryFinding_scanId_fkey] FOREIGN KEY ([scanId]) REFERENCES [dbo].[InventoryScan]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[InventoryFinding] ADD CONSTRAINT [InventoryFinding_certificateId_fkey] FOREIGN KEY ([certificateId]) REFERENCES [dbo].[Certificate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Alert] ADD CONSTRAINT [Alert_certificateId_fkey] FOREIGN KEY ([certificateId]) REFERENCES [dbo].[Certificate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Alert] ADD CONSTRAINT [Alert_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Alert] ADD CONSTRAINT [Alert_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[CertificateOwner]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_alertId_fkey] FOREIGN KEY ([alertId]) REFERENCES [dbo].[Alert]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SecurityFinding] ADD CONSTRAINT [SecurityFinding_certificateId_fkey] FOREIGN KEY ([certificateId]) REFERENCES [dbo].[Certificate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SecurityFinding] ADD CONSTRAINT [SecurityFinding_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AgentIdentity] ADD CONSTRAINT [AgentIdentity_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AgentNonce] ADD CONSTRAINT [AgentNonce_agentId_fkey] FOREIGN KEY ([agentId]) REFERENCES [dbo].[AgentIdentity]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RenewalRequest] ADD CONSTRAINT [RenewalRequest_certificateId_fkey] FOREIGN KEY ([certificateId]) REFERENCES [dbo].[Certificate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RenewalRequest] ADD CONSTRAINT [RenewalRequest_newCertificateId_fkey] FOREIGN KEY ([newCertificateId]) REFERENCES [dbo].[Certificate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RenewalTarget] ADD CONSTRAINT [RenewalTarget_renewalId_fkey] FOREIGN KEY ([renewalId]) REFERENCES [dbo].[RenewalRequest]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RenewalTarget] ADD CONSTRAINT [RenewalTarget_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalRequest] ADD CONSTRAINT [ApprovalRequest_renewalId_fkey] FOREIGN KEY ([renewalId]) REFERENCES [dbo].[RenewalRequest]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalRequest] ADD CONSTRAINT [ApprovalRequest_maintenanceWindowId_fkey] FOREIGN KEY ([maintenanceWindowId]) REFERENCES [dbo].[MaintenanceWindow]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ApprovalDecision] ADD CONSTRAINT [ApprovalDecision_approvalId_fkey] FOREIGN KEY ([approvalId]) REFERENCES [dbo].[ApprovalRequest]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentJob] ADD CONSTRAINT [DeploymentJob_renewalId_fkey] FOREIGN KEY ([renewalId]) REFERENCES [dbo].[RenewalRequest]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentJob] ADD CONSTRAINT [DeploymentJob_approvalId_fkey] FOREIGN KEY ([approvalId]) REFERENCES [dbo].[ApprovalRequest]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentJob] ADD CONSTRAINT [DeploymentJob_maintenanceWindowId_fkey] FOREIGN KEY ([maintenanceWindowId]) REFERENCES [dbo].[MaintenanceWindow]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentTarget] ADD CONSTRAINT [DeploymentTarget_jobId_fkey] FOREIGN KEY ([jobId]) REFERENCES [dbo].[DeploymentJob]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentTarget] ADD CONSTRAINT [DeploymentTarget_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[DeploymentAttempt] ADD CONSTRAINT [DeploymentAttempt_targetId_fkey] FOREIGN KEY ([targetId]) REFERENCES [dbo].[DeploymentTarget]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VerificationResult] ADD CONSTRAINT [VerificationResult_targetId_fkey] FOREIGN KEY ([targetId]) REFERENCES [dbo].[DeploymentTarget]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RollbackOperation] ADD CONSTRAINT [RollbackOperation_targetId_fkey] FOREIGN KEY ([targetId]) REFERENCES [dbo].[DeploymentTarget]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_certificateId_fkey] FOREIGN KEY ([certificateId]) REFERENCES [dbo].[Certificate]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Incident] ADD CONSTRAINT [Incident_terminalId_fkey] FOREIGN KEY ([terminalId]) REFERENCES [dbo].[Terminal]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MetricObservation] ADD CONSTRAINT [MetricObservation_snapshotId_fkey] FOREIGN KEY ([snapshotId]) REFERENCES [dbo].[BaselineSnapshot]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TestEvidence] ADD CONSTRAINT [TestEvidence_runId_fkey] FOREIGN KEY ([runId]) REFERENCES [dbo].[ExperimentalRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH

